CREATE TYPE member_role AS ENUM ('owner', 'manager');

CREATE TABLE organizer_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role member_role NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX organizer_members_organizer_id_idx
  ON organizer_members (organizer_id);

