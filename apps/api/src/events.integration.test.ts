import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "./config.js";
import { createOrganizerEvent } from "./events.js";
import { IdempotencyConflictError } from "./idempotency.js";

const testPool = new pg.Pool({ connectionString: config.databaseUrl });
const actorId = randomUUID();
const idempotencyKey = randomUUID();
let organizerId: string;

const eventInput = {
  name: `Idempotent Event ${randomUUID()}`,
  venue: "Concurrency Hall",
  startsAt: new Date(Date.now() + 86_400_000).toISOString(),
  rows: 2,
  seatsPerRow: 3,
  priceRupees: 750,
};

beforeAll(async () => {
  organizerId = (await testPool.query(
    "INSERT INTO organizers (name) VALUES ($1) RETURNING id",
    [`Idempotency Test ${randomUUID()}`],
  )).rows[0].id;
});

afterAll(async () => {
  await testPool.query(
    "DELETE FROM seats WHERE event_id IN (SELECT id FROM events WHERE organizer_id = $1)",
    [organizerId],
  );
  await testPool.query("DELETE FROM events WHERE organizer_id = $1", [organizerId]);
  await testPool.query(
    "DELETE FROM idempotency_requests WHERE operation = 'create_organizer_event' AND actor_scope = $1",
    [organizerId],
  );
  await testPool.query("DELETE FROM organizers WHERE id = $1", [organizerId]);
  await testPool.end();
});

describe("organizer event idempotency", () => {
  it("collapses concurrent retries into one event and one seat inventory", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => createOrganizerEvent(
        eventInput,
        organizerId,
        actorId,
        idempotencyKey,
      )),
    );

    expect(new Set(results.map((result) => result.event.id))).toHaveLength(1);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(results.filter((result) => result.replayed)).toHaveLength(9);

    const events = await testPool.query(
      "SELECT id FROM events WHERE organizer_id = $1 AND name = $2",
      [organizerId, eventInput.name],
    );
    expect(events.rowCount).toBe(1);
    const seats = await testPool.query(
      "SELECT count(*)::int AS count FROM seats WHERE event_id = $1",
      [events.rows[0].id],
    );
    expect(seats.rows[0].count).toBe(6);
  });

  it("rejects reuse of the same key with different event details", async () => {
    await expect(createOrganizerEvent(
      { ...eventInput, name: "Different Event" },
      organizerId,
      actorId,
      idempotencyKey,
    )).rejects.toBeInstanceOf(IdempotencyConflictError);
  });
});
