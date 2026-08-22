DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'seatlock_app') THEN
    CREATE ROLE seatlock_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO seatlock_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON events, seats, reservations, idempotency_requests
  TO seatlock_app;

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY events_public_read ON events
  FOR SELECT TO seatlock_app
  USING (current_setting('app.access_mode', true) = 'public');

CREATE POLICY events_tenant_read ON events
  FOR SELECT TO seatlock_app
  USING (
    current_setting('app.access_mode', true) = 'tenant'
    AND organizer_id = nullif(current_setting('app.organizer_id', true), '')::uuid
  );

CREATE POLICY events_tenant_insert ON events
  FOR INSERT TO seatlock_app
  WITH CHECK (
    current_setting('app.access_mode', true) = 'tenant'
    AND organizer_id = nullif(current_setting('app.organizer_id', true), '')::uuid
  );

CREATE POLICY events_tenant_update ON events
  FOR UPDATE TO seatlock_app
  USING (
    current_setting('app.access_mode', true) = 'tenant'
    AND organizer_id = nullif(current_setting('app.organizer_id', true), '')::uuid
  )
  WITH CHECK (
    organizer_id = nullif(current_setting('app.organizer_id', true), '')::uuid
  );

CREATE POLICY events_tenant_delete ON events
  FOR DELETE TO seatlock_app
  USING (
    current_setting('app.access_mode', true) = 'tenant'
    AND organizer_id = nullif(current_setting('app.organizer_id', true), '')::uuid
  );

CREATE POLICY seats_public_read ON seats
  FOR SELECT TO seatlock_app
  USING (current_setting('app.access_mode', true) = 'public');

CREATE POLICY seats_public_lock ON seats
  FOR UPDATE TO seatlock_app
  USING (current_setting('app.access_mode', true) = 'public')
  WITH CHECK (false);

CREATE POLICY seats_tenant_all ON seats
  FOR ALL TO seatlock_app
  USING (
    current_setting('app.access_mode', true) = 'tenant'
    AND EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = seats.event_id
        AND e.organizer_id = nullif(current_setting('app.organizer_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.access_mode', true) = 'tenant'
    AND EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = seats.event_id
        AND e.organizer_id = nullif(current_setting('app.organizer_id', true), '')::uuid
    )
  );

CREATE POLICY reservations_public_access ON reservations
  FOR ALL TO seatlock_app
  USING (current_setting('app.access_mode', true) = 'public')
  WITH CHECK (current_setting('app.access_mode', true) = 'public');

CREATE POLICY reservations_tenant_read ON reservations
  FOR SELECT TO seatlock_app
  USING (
    current_setting('app.access_mode', true) = 'tenant'
    AND EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = reservations.event_id
        AND e.organizer_id = nullif(current_setting('app.organizer_id', true), '')::uuid
    )
  );
