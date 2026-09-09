import { withDatabaseContext } from "./db-context.js";
import { recordAuditEvent } from "./audit.js";

export async function expireHoldsBatch(limit = 100) {
  return withDatabaseContext({ accessMode: "public" }, async (client) => {
    const result = await client.query(
      `WITH expired AS (
         SELECT id
         FROM reservations
         WHERE status = 'held' AND expires_at <= now()
         ORDER BY expires_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE reservations r
       SET status = 'cancelled'
       FROM expired
       WHERE r.id = expired.id
       RETURNING r.id, r.event_id, r.seat_id`,
      [limit],
    );
    for (const expired of result.rows) {
      const organizer = await client.query(
        "SELECT organizer_id FROM events WHERE id = $1",
        [expired.event_id],
      );
      await recordAuditEvent(client, {
        organizerId: organizer.rows[0]?.organizer_id,
        actorType: "system",
        action: "seat_hold.expired",
        entityType: "reservation",
        entityId: expired.id,
        metadata: { eventId: expired.event_id, seatId: expired.seat_id },
      });
      await client.query("SELECT pg_notify('seat_inventory_changed', $1)", [expired.event_id]);
    }
    return result.rows;
  });
}
