import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import { recordAuditEvent } from "./audit.js";
import { createToken, hashPassword, requireAuth, verifyPassword, type AuthenticatedRequest } from "./auth.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { queryWithContext, setDatabaseContext } from "./db-context.js";
import { confirmHold, createHold, HoldConflictError, HoldExpiredError, HoldNotFoundError } from "./holds.js";
import { createOrganizerEvent } from "./events.js";
import { IdempotencyConflictError } from "./idempotency.js";
import { incrementCounter, renderMetrics } from "./metrics.js";
import { createEventInput, idempotencyKeyInput, loginInput, registerInput, reservationInput } from "./validation.js";

export const app = express();

app.use((request, response, next) => {
  const requestId = request.header("x-request-id") ?? randomUUID();
  const startedAt = Date.now();
  response.setHeader("X-Request-Id", requestId);
  response.on("finish", () => {
    const statusClass = `${Math.floor(response.statusCode / 100)}xx`;
    incrementCounter("seatlock_http_requests_total", { method: request.method, status: statusClass });
    console.log(JSON.stringify({
      event: "http_request",
      request_id: requestId,
      method: request.method,
      path: request.path,
      status: response.statusCode,
      duration_ms: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    }));
  });
  next();
});
app.use((request, response, next) => {
  const origin = request.header("origin")?.replace(/\/$/, "");
  if (origin && !config.allowedOrigins.includes(origin)) {
    response.status(403).json({ error: "Origin is not allowed" });
    return;
  }
  next();
});
app.use(cors({ origin: config.allowedOrigins }));
app.use(express.json());

app.get("/health", async (_request, response, next) => {
  try {
    await pool.query("SELECT 1");
    response.json({ status: "ok", database: "connected" });
  } catch (error) {
    next(error);
  }
});

app.get("/metrics", (_request, response) => {
  response.type("text/plain; version=0.0.4").send(renderMetrics());
});

app.post("/api/auth/register", async (request, response, next) => {
  const parsed = registerInput.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid registration", details: parsed.error.flatten() });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const organizer = await client.query(
      "INSERT INTO organizers (name) VALUES ($1) RETURNING id, name",
      [parsed.data.organizationName],
    );
    const passwordHash = await hashPassword(parsed.data.password);
    const member = await client.query(
      `INSERT INTO organizer_members (organizer_id, name, email, password_hash)
       VALUES ($1, $2, lower($3), $4)
       RETURNING id, organizer_id, name, email, role`,
      [organizer.rows[0].id, parsed.data.name, parsed.data.email, passwordHash],
    );
    await recordAuditEvent(client, {
      organizerId: organizer.rows[0].id,
      actorType: "organizer",
      actorId: member.rows[0].id,
      action: "organizer.registered",
      entityType: "organizer",
      entityId: organizer.rows[0].id,
    });
    await client.query("COMMIT");
    const user = member.rows[0];
    response.status(201).json({
      token: createToken({ userId: user.id, organizerId: user.organizer_id, role: user.role }),
      user,
      organizer: organizer.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      response.status(409).json({ error: "An account with that email already exists" });
      return;
    }
    next(error);
  } finally {
    client.release();
  }
});

app.post("/api/auth/login", async (request, response, next) => {
  const parsed = loginInput.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Enter a valid email and password" });
    return;
  }
  try {
    const result = await pool.query(
      `SELECT m.id, m.organizer_id, m.name, m.email, m.role, m.password_hash,
              o.name AS organization_name
       FROM organizer_members m
       JOIN organizers o ON o.id = m.organizer_id
       WHERE m.email = lower($1)`,
      [parsed.data.email],
    );
    const user = result.rows[0];
    if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
      response.status(401).json({ error: "Incorrect email or password" });
      return;
    }
    response.json({
      token: createToken({ userId: user.id, organizerId: user.organizer_id, role: user.role }),
      user: { id: user.id, organizer_id: user.organizer_id, name: user.name, email: user.email, role: user.role },
      organizer: { id: user.organizer_id, name: user.organization_name },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/organizer/me", requireAuth, async (request: AuthenticatedRequest, response, next) => {
  try {
    const result = await pool.query(
      `SELECT m.id, m.name, m.email, m.role, o.id AS organizer_id, o.name AS organization_name
       FROM organizer_members m
       JOIN organizers o ON o.id = m.organizer_id
       WHERE m.id = $1 AND m.organizer_id = $2`,
      [request.session!.userId, request.session!.organizerId],
    );
    if (!result.rows[0]) {
      response.status(404).json({ error: "Account not found" });
      return;
    }
    response.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.get("/api/organizer/events", requireAuth, async (request: AuthenticatedRequest, response, next) => {
  try {
    const result = await queryWithContext(
      { accessMode: "tenant", organizerId: request.session!.organizerId },
      `SELECT e.id, e.name, e.venue, e.starts_at,
              count(s.id)::int AS seat_count,
              count(r.id) FILTER (WHERE r.status = 'confirmed')::int AS reserved_count
       FROM events e
       LEFT JOIN seats s ON s.event_id = e.id
       LEFT JOIN reservations r ON r.seat_id = s.id AND r.status = 'confirmed'
       WHERE e.organizer_id = $1
       GROUP BY e.id
       ORDER BY e.starts_at`,
      [request.session!.organizerId],
    );
    response.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.get("/api/organizer/audit-events", requireAuth, async (request: AuthenticatedRequest, response, next) => {
  try {
    const result = await queryWithContext(
      { accessMode: "tenant", organizerId: request.session!.organizerId },
      `SELECT id, actor_type, actor_id, action, entity_type, entity_id, metadata, created_at
       FROM audit_events
       ORDER BY created_at DESC
       LIMIT 50`,
    );
    response.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/organizer/events", requireAuth, async (request: AuthenticatedRequest, response, next) => {
  const parsed = createEventInput.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid event", details: parsed.error.flatten() });
    return;
  }

  const parsedKey = idempotencyKeyInput.safeParse(request.header("idempotency-key"));
  if (!parsedKey.success) {
    response.status(400).json({ error: "A valid Idempotency-Key header is required" });
    return;
  }

  try {
    const result = await createOrganizerEvent(
      parsed.data,
      request.session!.organizerId,
      request.session!.userId,
      parsedKey.data,
    );
    response.setHeader("Idempotency-Replayed", String(result.replayed));
    response.status(result.replayed ? 200 : 201).json(result.event);
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      response.status(409).json({ error: error.message });
      return;
    }
    next(error);
  }
});

app.get("/api/events", async (_request, response, next) => {
  try {
    const result = await queryWithContext({ accessMode: "public" }, `
      SELECT e.id, e.name, e.venue, e.starts_at,
             count(s.id)::int AS seat_count,
             count(r.id) FILTER (WHERE r.status = 'confirmed')::int AS reserved_count
      FROM events e
      LEFT JOIN seats s ON s.event_id = e.id
      LEFT JOIN reservations r ON r.seat_id = s.id AND r.status = 'confirmed'
      GROUP BY e.id
      ORDER BY e.starts_at
    `);
    response.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.get("/api/events/:eventId/seats", async (request, response, next) => {
  try {
    const result = await queryWithContext(
      { accessMode: "public" },
      `SELECT s.id, s.label, s.price_paise,
              pt.name AS pricing_tier, pt.color AS pricing_color,
              (r.id IS NOT NULL) AS reserved
       FROM seats s
       JOIN event_pricing_tiers pt ON pt.id = s.pricing_tier_id
       LEFT JOIN reservations r
         ON r.seat_id = s.id
        AND (r.status = 'confirmed' OR (r.status = 'held' AND r.expires_at > now()))
       WHERE s.event_id = $1
       ORDER BY s.label`,
      [request.params.eventId],
    );
    response.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/holds", async (request, response, next) => {
  const parsed = reservationInput.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      error: "Invalid reservation",
      details: parsed.error.flatten(),
    });
    return;
  }

  const parsedKey = idempotencyKeyInput.safeParse(request.header("idempotency-key"));
  if (!parsedKey.success) {
    response.status(400).json({ error: "A valid Idempotency-Key header is required" });
    return;
  }

  try {
    const result = await createHold(parsed.data, parsedKey.data);
    response.setHeader("Idempotency-Replayed", String(result.replayed));
    response.status(result.replayed ? 200 : 201).json(result.hold);
  } catch (error) {
    if (error instanceof HoldConflictError) {
      response.status(409).json({ error: error.message });
      return;
    }
    if (error instanceof HoldNotFoundError) {
      response.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof IdempotencyConflictError) {
      response.status(409).json({ error: error.message });
      return;
    }
    next(error);
  }
});

app.post("/api/holds/:holdToken/confirm", async (request, response, next) => {
  try {
    response.json(await confirmHold(request.params.holdToken));
  } catch (error) {
    if (error instanceof HoldExpiredError) {
      response.status(410).json({ error: error.message });
      return;
    }
    if (error instanceof HoldNotFoundError) {
      response.status(404).json({ error: error.message });
      return;
    }
    next(error);
  }
});

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(JSON.stringify({
      event: "http_request_failed",
      request_id: response.getHeader("X-Request-Id"),
      message: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    }));
    response.status(500).json({ error: "Unexpected server error" });
  },
);
