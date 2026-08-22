import { recordAuditEvent } from "./audit.js";
import { pool } from "./db.js";
import { setDatabaseContext } from "./db-context.js";
import { hashIdempotencyRequest, IdempotencyConflictError } from "./idempotency.js";
import { incrementCounter } from "./metrics.js";
import type { CreateEventInput } from "./validation.js";

export async function createOrganizerEvent(
  input: CreateEventInput,
  organizerId: string,
  actorId: string,
  idempotencyKey: string,
) {
  const client = await pool.connect();
  const operation = "create_organizer_event";
  const lockKey = `${operation}:${organizerId}:${idempotencyKey}`;
  const requestHash = hashIdempotencyRequest(input);

  try {
    await client.query("BEGIN");
    await setDatabaseContext(client, { accessMode: "tenant", organizerId });
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockKey]);

    const previous = await client.query(
      `SELECT request_hash, response
       FROM idempotency_requests
       WHERE operation = $1 AND actor_scope = $2 AND key = $3`,
      [operation, organizerId, idempotencyKey],
    );
    if (previous.rows[0]) {
      if (previous.rows[0].request_hash !== requestHash) {
        throw new IdempotencyConflictError(
          "That Idempotency-Key was already used with different event details",
        );
      }
      await client.query("COMMIT");
      incrementCounter("seatlock_idempotency_replays_total", { operation });
      return { event: previous.rows[0].response, replayed: true };
    }

    const eventResult = await client.query(
      `INSERT INTO events (organizer_id, name, venue, starts_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, venue, starts_at`,
      [organizerId, input.name, input.venue, input.startsAt],
    );
    const createdEvent = eventResult.rows[0];
    for (let rowIndex = 0; rowIndex < input.rows; rowIndex += 1) {
      const rowLabel = String.fromCharCode(65 + rowIndex);
      for (let seatNumber = 1; seatNumber <= input.seatsPerRow; seatNumber += 1) {
        await client.query(
          "INSERT INTO seats (event_id, label, price_paise) VALUES ($1, $2, $3)",
          [createdEvent.id, `${rowLabel}${seatNumber}`, input.priceRupees * 100],
        );
      }
    }

    const response = {
      ...createdEvent,
      seat_count: input.rows * input.seatsPerRow,
    };
    await client.query(
      `INSERT INTO idempotency_requests
         (key, operation, actor_scope, request_hash, response)
       VALUES ($1, $2, $3, $4, $5)`,
      [idempotencyKey, operation, organizerId, requestHash, JSON.stringify(response)],
    );
    await recordAuditEvent(client, {
      organizerId,
      actorType: "organizer",
      actorId,
      action: "event.created",
      entityType: "event",
      entityId: createdEvent.id,
      metadata: { seatCount: response.seat_count },
    });
    await client.query("COMMIT");
    incrementCounter("seatlock_events_created_total");
    return { event: response, replayed: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
