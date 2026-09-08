import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "./config.js";

const testPool = new pg.Pool({ connectionString: config.databaseUrl });
let organizerA: string;
let organizerB: string;
let eventA: string;
let eventB: string;
let seatA: string;
let seatB: string;
let tierA: string;
let tierB: string;

async function queryAsTenant(
  organizerId: string,
  text: string,
  values: unknown[] = [],
) {
  const client = await testPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE seatlock_app");
    await client.query("SELECT set_config('app.access_mode', 'tenant', true)");
    await client.query(
      "SELECT set_config('app.organizer_id', $1, true)",
      [organizerId],
    );
    const result = await client.query(text, values);
    await client.query("ROLLBACK");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  organizerA = (await testPool.query(
    "INSERT INTO organizers (name) VALUES ('RLS Organization A') RETURNING id",
  )).rows[0].id;
  organizerB = (await testPool.query(
    "INSERT INTO organizers (name) VALUES ('RLS Organization B') RETURNING id",
  )).rows[0].id;
  eventA = (await testPool.query(
    `INSERT INTO events (organizer_id, name, venue, starts_at)
     VALUES ($1, 'Tenant A Event', 'A Hall', now() + interval '1 day') RETURNING id`,
    [organizerA],
  )).rows[0].id;
  eventB = (await testPool.query(
    `INSERT INTO events (organizer_id, name, venue, starts_at)
     VALUES ($1, 'Tenant B Event', 'B Hall', now() + interval '1 day') RETURNING id`,
    [organizerB],
  )).rows[0].id;
  tierA = (await testPool.query(
    `INSERT INTO event_pricing_tiers (event_id, name, price_paise, color, sort_order)
     VALUES ($1, 'Standard', 10000, '#80ED99', 0) RETURNING id`,
    [eventA],
  )).rows[0].id;
  tierB = (await testPool.query(
    `INSERT INTO event_pricing_tiers (event_id, name, price_paise, color, sort_order)
     VALUES ($1, 'Standard', 10000, '#80ED99', 0) RETURNING id`,
    [eventB],
  )).rows[0].id;
  seatA = (await testPool.query(
    "INSERT INTO seats (event_id, pricing_tier_id, label, price_paise) VALUES ($1, $2, 'A1', 10000) RETURNING id",
    [eventA, tierA],
  )).rows[0].id;
  seatB = (await testPool.query(
    "INSERT INTO seats (event_id, pricing_tier_id, label, price_paise) VALUES ($1, $2, 'B1', 10000) RETURNING id",
    [eventB, tierB],
  )).rows[0].id;
  await testPool.query(
    `INSERT INTO reservations
       (event_id, seat_id, customer_name, customer_email, status)
     VALUES
       ($1, $2, 'Customer A', 'a@example.com', 'confirmed'),
       ($3, $4, 'Customer B', 'b@example.com', 'confirmed')`,
    [eventA, seatA, eventB, seatB],
  );
});

afterAll(async () => {
  await testPool.query("DELETE FROM reservations WHERE event_id IN ($1, $2)", [eventA, eventB]);
  await testPool.query("DELETE FROM seats WHERE event_id IN ($1, $2)", [eventA, eventB]);
  await testPool.query("DELETE FROM events WHERE id IN ($1, $2)", [eventA, eventB]);
  await testPool.query("DELETE FROM organizers WHERE id IN ($1, $2)", [organizerA, organizerB]);
  await testPool.end();
});

describe("PostgreSQL tenant isolation", () => {
  it("shows organization A only its own event, seats, and reservations", async () => {
    const events = await queryAsTenant(organizerA, "SELECT id FROM events ORDER BY id");
    const seats = await queryAsTenant(organizerA, "SELECT id FROM seats ORDER BY id");
    const reservations = await queryAsTenant(organizerA, "SELECT event_id FROM reservations ORDER BY event_id");
    expect(events.rows.map((row) => row.id)).toEqual([eventA]);
    expect(seats.rows.map((row) => row.id)).toEqual([seatA]);
    expect(reservations.rows.map((row) => row.event_id)).toEqual([eventA]);
  });

  it("turns a cross-tenant update into a zero-row operation", async () => {
    const result = await queryAsTenant(
      organizerA,
      "UPDATE events SET name = 'Compromised' WHERE id = $1 RETURNING id",
      [eventB],
    );
    expect(result.rowCount).toBe(0);
  });

  it("rejects inserting a seat into another tenant's event", async () => {
    await expect(queryAsTenant(
      organizerA,
      "INSERT INTO seats (event_id, pricing_tier_id, label, price_paise) VALUES ($1, $2, 'X1', 100)",
      [eventB, tierB],
    )).rejects.toThrow(/row-level security policy/i);
  });
});
