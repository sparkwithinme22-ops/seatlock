import { randomUUID } from "node:crypto";
import { recordAuditEvent } from "./audit.js";
import { pool } from "./db.js";
import { setDatabaseContext } from "./db-context.js";
import { incrementCounter } from "./metrics.js";
import { hashIdempotencyRequest, IdempotencyConflictError } from "./idempotency.js";
import type { ReservationInput } from "./validation.js";

export { IdempotencyConflictError } from "./idempotency.js";

const holdDurationMinutes = 5;

export class HoldConflictError extends Error {}
export class HoldNotFoundError extends Error {}
export class HoldExpiredError extends Error {}
function requestHash(input: ReservationInput) {
  return hashIdempotencyRequest({
    eventId: input.eventId,
    seatId: input.seatId,
    customerName: input.customerName,
    customerEmail: input.customerEmail.toLowerCase(),
  });
}

export async function createHold(input: ReservationInput, idempotencyKey: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setDatabaseContext(client, { accessMode: "public" });
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [idempotencyKey]);
    const hash = requestHash(input);
    const previous = await client.query(
      `SELECT request_hash, response
       FROM idempotency_requests
       WHERE key = $1 AND operation = 'create_hold' AND actor_scope = 'public'`,
      [idempotencyKey],
    );
    if (previous.rows[0]) {
      if (previous.rows[0].request_hash !== hash) {
        throw new IdempotencyConflictError(
          "That Idempotency-Key was already used with different booking details",
        );
      }
      await client.query("COMMIT");
      incrementCounter("seatlock_idempotency_replays_total", { operation: "create_hold" });
      return { hold: previous.rows[0].response, replayed: true };
    }

    const seat = await client.query(
      `SELECT s.id, e.organizer_id
       FROM seats s
       JOIN events e ON e.id = s.event_id
       WHERE s.id = $1 AND s.event_id = $2
       FOR UPDATE OF s`,
      [input.seatId, input.eventId],
    );
    if (!seat.rows[0]) throw new HoldNotFoundError("Seat not found for this event");

    await client.query(
      `UPDATE reservations
       SET status = 'cancelled'
       WHERE seat_id = $1 AND status = 'held' AND expires_at <= now()`,
      [input.seatId],
    );

    const active = await client.query(
      `SELECT id FROM reservations
       WHERE seat_id = $1 AND status IN ('held', 'confirmed')`,
      [input.seatId],
    );
    if (active.rows[0]) throw new HoldConflictError("That seat is already held or reserved");

    const holdToken = randomUUID();
    const result = await client.query(
      `INSERT INTO reservations
         (event_id, seat_id, customer_name, customer_email, status, hold_token, expires_at)
       VALUES ($1, $2, $3, lower($4), 'held', $5, now() + ($6 * interval '1 minute'))
       RETURNING id, event_id, seat_id, customer_name, customer_email,
                 status, hold_token, expires_at, created_at`,
      [input.eventId, input.seatId, input.customerName, input.customerEmail, holdToken, holdDurationMinutes],
    );
    await client.query(
      `INSERT INTO idempotency_requests
         (key, operation, actor_scope, request_hash, response)
       VALUES ($1, 'create_hold', 'public', $2, $3)`,
      [idempotencyKey, hash, JSON.stringify(result.rows[0])],
    );
    await recordAuditEvent(client, {
      organizerId: seat.rows[0].organizer_id,
      actorType: "customer",
      action: "seat.held",
      entityType: "reservation",
      entityId: result.rows[0].id,
      metadata: { eventId: input.eventId, seatId: input.seatId },
    });
    await client.query("COMMIT");
    incrementCounter("seatlock_holds_created_total");
    return { hold: result.rows[0], replayed: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function confirmHold(holdToken: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setDatabaseContext(client, { accessMode: "public" });
    const result = await client.query(
      `SELECT r.id, r.event_id, r.seat_id, r.status, r.expires_at, e.organizer_id
       FROM reservations r
       JOIN events e ON e.id = r.event_id
       WHERE r.hold_token = $1
       FOR UPDATE OF r`,
      [holdToken],
    );
    const hold = result.rows[0];
    if (!hold) {
      throw new HoldNotFoundError("Active seat hold not found");
    }
    if (hold.status === "confirmed") {
      const alreadyConfirmed = await client.query(
        `SELECT id, event_id, seat_id, customer_name, customer_email, status, created_at
         FROM reservations WHERE id = $1`,
        [hold.id],
      );
      await client.query("COMMIT");
      return alreadyConfirmed.rows[0];
    }
    if (hold.status !== "held") throw new HoldNotFoundError("Active seat hold not found");
    if (new Date(hold.expires_at).getTime() <= Date.now()) {
      await client.query(
        "UPDATE reservations SET status = 'cancelled' WHERE id = $1",
        [hold.id],
      );
      await client.query("COMMIT");
      throw new HoldExpiredError("This seat hold has expired");
    }
    const confirmed = await client.query(
      `UPDATE reservations
       SET status = 'confirmed', expires_at = NULL
       WHERE id = $1
       RETURNING id, event_id, seat_id, customer_name, customer_email, status, created_at`,
      [hold.id],
    );
    await recordAuditEvent(client, {
      organizerId: hold.organizer_id,
      actorType: "customer",
      action: "booking.confirmed",
      entityType: "reservation",
      entityId: hold.id,
      metadata: { eventId: hold.event_id, seatId: hold.seat_id },
    });
    await client.query("COMMIT");
    incrementCounter("seatlock_bookings_confirmed_total");
    return confirmed.rows[0];
  } catch (error) {
    if (!(error instanceof HoldExpiredError)) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
