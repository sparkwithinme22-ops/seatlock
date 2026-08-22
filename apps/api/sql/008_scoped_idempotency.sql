ALTER TABLE idempotency_requests
  ADD COLUMN actor_scope text NOT NULL DEFAULT 'public';

ALTER TABLE idempotency_requests
  DROP CONSTRAINT idempotency_requests_pkey;

ALTER TABLE idempotency_requests
  ADD PRIMARY KEY (operation, actor_scope, key);
