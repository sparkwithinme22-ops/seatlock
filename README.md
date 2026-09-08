# SeatLock

SeatLock is a full-stack ticket reservation platform built around the failure
modes that make real booking systems difficult: simultaneous buyers, retrying
clients, expiring inventory locks, tenant isolation, and auditable state changes.

It includes a customer booking flow, an authenticated organizer portal, a
separate expiration worker, PostgreSQL-enforced isolation, and production
deployment configuration.

## Live deployment

- **Frontend:** https://seatlock-chi.vercel.app
- **API health:** https://seatlock-api-g9l0.onrender.com/health
- **Source:** https://github.com/sparkwithinme22-ops/seatlock

The API uses Render's free web-service plan, so the first request after a period
of inactivity can take longer while the service wakes up.

## Engineering highlights

- **Concurrency-safe inventory:** seat rows are locked with `SELECT ... FOR
  UPDATE`, while a partial unique index provides a final database invariant.
- **Temporary reservations:** five-minute holds reserve inventory before
  confirmation and are reclaimed in batches by a separate worker using
  `FOR UPDATE SKIP LOCKED`.
- **Idempotent writes:** request hashes and response snapshots ensure retried
  hold and organizer-event requests produce one mutation; PostgreSQL advisory
  locks serialize simultaneous retries using the same scoped key.
- **Multi-tenant security:** PostgreSQL Row-Level Security restricts organizer
  events, seats, reservations, and audit records at the database layer.
- **Tiered inventory:** organizers can assign named, color-coded pricing tiers
  to rows while each generated seat retains its exact transactional price.
- **Transactional auditability:** important state changes write immutable audit
  events in the same transaction as the business operation.
- **Operational visibility:** structured JSON request logs, request IDs,
  health checks, and Prometheus-compatible metrics are built in.

## Architecture

```text
React browser → Express REST API → PostgreSQL
                            ↑
                  Expiration worker
```

## Run locally

Requirements: Node.js 24 LTS, npm, and Docker Desktop.

```bash
cp .env.example .env
docker compose up -d
npm install
npm run dev
```

Open `http://localhost:5173`. The API runs at `http://localhost:3001`.

The PostgreSQL container automatically creates the schema and demo event the
first time it starts. To rebuild the demo database, remove only the named
`seatlock-data` Docker volume and start the service again.

## Production configuration

The API requires `DATABASE_URL`, a random `JWT_SECRET` containing at least 32
characters, and `ALLOWED_ORIGINS` containing the comma-separated frontend
origins. The Vercel frontend requires `VITE_API_URL` set to the public API
origin. Hosting platforms normally provide `PORT` automatically.

Apply pending migrations with:

```bash
npm run migrate -w @seatlock/api
```

Migration runs are serialized with a PostgreSQL advisory lock and applied
filenames are recorded in `schema_migrations`. On Render, the API start command
runs migrations before accepting traffic, which also works on the free web
service plan. The included `render.yaml` and `vercel.json` provide the API,
and frontend build configuration. The worker remains available through
`npm run worker:start -w @seatlock/api`; deploy it as a Render background worker
when continuous proactive cleanup is required, because Render does not offer a
free background-worker instance type.

## Correctness guarantees

- At most one active hold or confirmed reservation exists for a seat.
- Twenty concurrent buyers competing for one seat produce one successful hold.
- Twenty simultaneous retries with one idempotency key produce one reservation.
- Reusing an idempotency key with different input is rejected.
- Confirmation is repeat-safe.
- Locked expiration jobs are skipped instead of blocking other worker instances.
- Cross-tenant reads and writes are rejected by PostgreSQL policies.
- Audit records cannot be updated or deleted.

These behaviors are covered by integration tests against PostgreSQL.

## Technology

React 19, TypeScript, Vite, Node.js, Express, PostgreSQL 17, JWT, Docker,
Vitest, Render, and Vercel.

## Milestones

- [x] Event and seat browsing
- [x] Basic confirmed reservations
- [x] Validation and duplicate-seat protection
- [x] Organizer registration, login, and protected dashboard
- [x] Transactional event and seat-inventory creation
- [x] Five-minute temporary seat holds
- [x] Row-locking concurrency protection and stress test
- [x] Idempotent hold creation and confirmation
- [x] PostgreSQL Row-Level Security for organizer isolation
- [x] Cross-tenant read and write isolation tests
- [x] Scheduled expiration worker with batched `SKIP LOCKED` processing
- [x] Append-only transactional audit trail
- [x] Structured request logs and Prometheus-style metrics
- [x] Idempotent booking requests
- [x] Multi-tenant isolation with Row-Level Security
- [ ] Concurrency and load testing
- [x] Production deployment

## Verification

```bash
npm run typecheck
npm test
npm run build
```

The API suite currently contains 20 tests, including concurrent booking,
organizer-event idempotency, expiration locking, RLS isolation, audit
immutability, validation, authentication, and metrics behavior.

## API

- `GET /health`
- `GET /metrics`
- `GET /api/events`
- `GET /api/events/:eventId/seats`
- `POST /api/holds`
- `POST /api/holds/:holdToken/confirm`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/organizer/me` (authenticated)
- `GET /api/organizer/events` (authenticated)
- `GET /api/organizer/audit-events` (authenticated, latest 50)
- `POST /api/organizer/events` (authenticated)
