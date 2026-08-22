import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { config } from "./config.js";

const testPool = new pg.Pool({ connectionString: config.databaseUrl });

afterAll(() => testPool.end());

describe("append-only tenant audit trail", () => {
  it("rejects changes to an existing audit event", async () => {
    const client = await testPool.connect();
    try {
      await client.query("BEGIN");
      const audit = await client.query(
        `INSERT INTO audit_events (actor_type, action, entity_type)
         VALUES ('system', 'test.created', 'test') RETURNING id`,
      );
      await expect(client.query(
        "UPDATE audit_events SET action = 'test.changed' WHERE id = $1",
        [audit.rows[0].id],
      )).rejects.toThrow(/append-only/i);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("shows a tenant only its own audit events", async () => {
    const client = await testPool.connect();
    try {
      await client.query("BEGIN");
      const organizations = await client.query(
        "INSERT INTO organizers (name) VALUES ('Audit A'), ('Audit B') RETURNING id",
      );
      const [organizerA, organizerB] = organizations.rows;
      await client.query(
        `INSERT INTO audit_events (organizer_id, actor_type, action, entity_type)
         VALUES ($1, 'system', 'test.a', 'test'), ($2, 'system', 'test.b', 'test')`,
        [organizerA.id, organizerB.id],
      );
      await client.query("SET LOCAL ROLE seatlock_app");
      await client.query("SELECT set_config('app.access_mode', 'tenant', true)");
      await client.query("SELECT set_config('app.organizer_id', $1, true)", [organizerA.id]);
      const visible = await client.query("SELECT organizer_id FROM audit_events");
      expect(visible.rows).toEqual([{ organizer_id: organizerA.id }]);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});

