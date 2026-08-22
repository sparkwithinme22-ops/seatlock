ALTER TABLE reservations
  ADD COLUMN hold_token uuid UNIQUE,
  ADD COLUMN expires_at timestamptz;

ALTER TABLE reservations
  ADD CONSTRAINT held_reservations_require_expiry CHECK (
    (status = 'held' AND hold_token IS NOT NULL AND expires_at IS NOT NULL)
    OR status <> 'held'
  );

DROP INDEX one_active_reservation_per_seat;

CREATE UNIQUE INDEX one_active_reservation_per_seat
  ON reservations (seat_id)
  WHERE status IN ('held', 'confirmed');

CREATE INDEX expiring_holds_idx
  ON reservations (expires_at)
  WHERE status = 'held';
