import { createHash } from "node:crypto";

export class IdempotencyConflictError extends Error {}

export function hashIdempotencyRequest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
