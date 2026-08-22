import type { PoolClient } from "pg";

export type AuditEvent = {
  organizerId?: string | null;
  actorType: "organizer" | "customer" | "system";
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function recordAuditEvent(client: PoolClient, event: AuditEvent) {
  await client.query(
    `INSERT INTO audit_events
       (organizer_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      event.organizerId ?? null,
      event.actorType,
      event.actorId ?? null,
      event.action,
      event.entityType,
      event.entityId ?? null,
      JSON.stringify(event.metadata ?? {}),
    ],
  );
}

