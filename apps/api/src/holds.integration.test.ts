import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "./db.js";
import { expireHoldsBatch } from "./expiration.js";
import {
  confirmHold,
  createHold,
  HoldConflictError,
  IdempotencyConflictError,
} from "./holds.js";

let organizerId: string;
let eventId: string;
let seatId: string;
let secondSeatId: string;
let thirdSeatId: string;
let pricingTierId: string;
let retryKey: string;
const usedIdempotencyKeys: string[] = [];

beforeAll(async () => {
  organizerId = (await pool.query(
    "INSERT INTO organizers (name) VALUES ('Concurrency Test') RETURNING id",
  )).rows[0].id;
  eventId = (await pool.query(
    `INSERT INTO events (organizer_id, name, venue, starts_at)
     VALUES ($1, 'Race Test', 'Test Venue', now() + interval '1 day') RETURNING id`,
    [organizerId],
  )).rows[0].id;
  pricingTierId = (await pool.query(
    `INSERT INTO event_pricing_tiers (event_id, name, price_paise, color, sort_order)
     VALUES ($1, 'Standard', 10000, '#80ED99', 0) RETURNING id`,
    [eventId],
  )).rows[0].id;
  seatId = (await pool.query(
    "INSERT INTO seats (event_id, pricing_tier_id, label, price_paise) VALUES ($1, $2, 'A1', 10000) RETURNING id",
    [eventId, pricingTierId],
  )).rows[0].id;
  secondSeatId = (await pool.query(
    "INSERT INTO seats (event_id, pricing_tier_id, label, price_paise) VALUES ($1, $2, 'A2', 10000) RETURNING id",
    [eventId, pricingTierId],
  )).rows[0].id;
  thirdSeatId = (await pool.query(
    "INSERT INTO seats (event_id, pricing_tier_id, label, price_paise) VALUES ($1, $2, 'A3', 10000) RETURNING id",
    [eventId, pricingTierId],
  )).rows[0].id;
});

afterAll(async () => {
  await pool.query("DELETE FROM reservations WHERE event_id = $1", [eventId]);
  await pool.query("DELETE FROM idempotency_requests WHERE key = ANY($1::uuid[])", [usedIdempotencyKeys]);
  await pool.query("DELETE FROM seats WHERE event_id = $1", [eventId]);
  await pool.query("DELETE FROM events WHERE id = $1", [eventId]);
  await pool.query("DELETE FROM organizers WHERE id = $1", [organizerId]);
  await pool.end();
});

describe("concurrent seat holds", () => {
  it("allows exactly one of 20 simultaneous requests to hold a seat", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) => {
        const key = randomUUID();
        usedIdempotencyKeys.push(key);
        return createHold({
          eventId,
          seatId,
          customerName: `Customer ${index}`,
          customerEmail: `customer-${index}@example.com`,
        }, key);
      }),
    );
    const successes = attempts.filter((attempt) => attempt.status === "fulfilled");
    const failures = attempts.filter((attempt) => attempt.status === "rejected");
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(19);
    expect(failures.every(
      (attempt) => attempt.status === "rejected" && attempt.reason instanceof HoldConflictError,
    )).toBe(true);
  });

  it("collapses 20 duplicate retries into one hold", async () => {
    retryKey = randomUUID();
    usedIdempotencyKeys.push(retryKey);
    const input = {
      eventId,
      seatId: secondSeatId,
      customerName: "Retry Customer",
      customerEmail: "retry@example.com",
    };
    const results = await Promise.all(
      Array.from({ length: 20 }, () => createHold(input, retryKey)),
    );
    expect(new Set(results.map((result) => result.hold.id)).size).toBe(1);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(results.filter((result) => result.replayed)).toHaveLength(19);

    const firstConfirmation = await confirmHold(results[0].hold.hold_token);
    const retryConfirmation = await confirmHold(results[0].hold.hold_token);
    expect(retryConfirmation.id).toBe(firstConfirmation.id);
    expect(retryConfirmation.status).toBe("confirmed");
  });

  it("rejects reuse of a key with different booking details", async () => {
    await expect(createHold({
      eventId,
      seatId: secondSeatId,
      customerName: "Different Customer",
      customerEmail: "retry@example.com",
    }, retryKey)).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("skips a locked expired hold and processes it after the lock is released", async () => {
    const expiredHold = (await pool.query(
      `INSERT INTO reservations
         (event_id, seat_id, customer_name, customer_email, status, hold_token, expires_at)
       VALUES ($1, $2, 'Expired Customer', 'expired@example.com', 'held', $3, now() - interval '1 minute')
       RETURNING id`,
      [eventId, thirdSeatId, randomUUID()],
    )).rows[0];

    const lockingClient = await pool.connect();
    try {
      await lockingClient.query("BEGIN");
      await lockingClient.query(
        "SELECT id FROM reservations WHERE id = $1 FOR UPDATE",
        [expiredHold.id],
      );
      expect(await expireHoldsBatch()).toHaveLength(0);
      await lockingClient.query("COMMIT");
    } finally {
      lockingClient.release();
    }

    expect(await expireHoldsBatch()).toHaveLength(1);
    const status = await pool.query(
      "SELECT status FROM reservations WHERE id = $1",
      [expiredHold.id],
    );
    expect(status.rows[0].status).toBe("cancelled");
  });
});
