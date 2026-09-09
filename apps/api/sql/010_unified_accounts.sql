CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO users (id, name, email, password_hash, created_at)
SELECT id, name, lower(email), password_hash, created_at
FROM organizer_members;

ALTER TABLE organizer_members ADD COLUMN user_id uuid REFERENCES users(id);
UPDATE organizer_members SET user_id = id;
ALTER TABLE organizer_members ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE organizer_members ADD CONSTRAINT organizer_members_user_id_key UNIQUE (user_id);

ALTER TABLE reservations ADD COLUMN customer_user_id uuid REFERENCES users(id);
UPDATE reservations r
SET customer_user_id = u.id
FROM users u
WHERE lower(r.customer_email) = u.email;

CREATE INDEX reservations_customer_user_created_idx
  ON reservations (customer_user_id, created_at DESC)
  WHERE status = 'confirmed';

GRANT SELECT ON users TO seatlock_app;

CREATE POLICY reservations_customer_read ON reservations
  FOR SELECT TO seatlock_app
  USING (
    current_setting('app.access_mode', true) = 'customer'
    AND customer_user_id = nullif(current_setting('app.user_id', true), '')::uuid
  );
