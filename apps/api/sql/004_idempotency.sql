CREATE TABLE idempotency_requests (
  key uuid PRIMARY KEY,
  operation text NOT NULL,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idempotency_requests_created_at_idx
  ON idempotency_requests (created_at);

