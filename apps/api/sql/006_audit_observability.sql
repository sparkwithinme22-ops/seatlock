CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid,
  actor_type text NOT NULL CHECK (actor_type IN ('organizer', 'customer', 'system')),
  actor_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_organizer_created_idx
  ON audit_events (organizer_id, created_at DESC);

CREATE INDEX audit_events_action_created_idx
  ON audit_events (action, created_at DESC);

CREATE FUNCTION reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only';
END;
$$;

CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();

GRANT SELECT, INSERT ON audit_events TO seatlock_app;

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_events_tenant_read ON audit_events
  FOR SELECT TO seatlock_app
  USING (
    current_setting('app.access_mode', true) = 'tenant'
    AND organizer_id = nullif(current_setting('app.organizer_id', true), '')::uuid
  );

CREATE POLICY audit_events_tenant_insert ON audit_events
  FOR INSERT TO seatlock_app
  WITH CHECK (
    current_setting('app.access_mode', true) = 'tenant'
    AND organizer_id = nullif(current_setting('app.organizer_id', true), '')::uuid
  );

CREATE POLICY audit_events_public_insert ON audit_events
  FOR INSERT TO seatlock_app
  WITH CHECK (current_setting('app.access_mode', true) = 'public');

