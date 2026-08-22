CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES organizers(id),
  name text NOT NULL,
  venue text NOT NULL,
  starts_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label text NOT NULL,
  price_paise integer NOT NULL CHECK (price_paise >= 0),
  UNIQUE (event_id, label)
);

CREATE TYPE reservation_status AS ENUM ('confirmed', 'cancelled');

CREATE TABLE reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id),
  seat_id uuid NOT NULL REFERENCES seats(id),
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  status reservation_status NOT NULL DEFAULT 'confirmed',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX one_active_reservation_per_seat
  ON reservations (seat_id)
  WHERE status = 'confirmed';

INSERT INTO organizers (id, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'SeatLock Demo');

INSERT INTO events (id, organizer_id, name, venue, starts_at)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'Indie Night Live',
  'City Amphitheatre',
  now() + interval '14 days'
);

INSERT INTO seats (event_id, label, price_paise)
SELECT
  '10000000-0000-4000-8000-000000000001',
  row_letter || seat_number,
  CASE row_letter WHEN 'A' THEN 120000 ELSE 80000 END
FROM unnest(ARRAY['A', 'B']) AS row_letter
CROSS JOIN generate_series(1, 8) AS seat_number;
