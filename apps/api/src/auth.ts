import { promisify } from "node:util";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";

const scrypt = promisify(scryptCallback);

export type Session = {
  userId: string;
  organizerId?: string;
  role: "customer" | "owner" | "manager";
};

export interface AuthenticatedRequest extends Request {
  session?: Session;
}

export function requireOrganizer(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
) {
  requireAuth(request, response, () => {
    if (!request.session?.organizerId || request.session.role === "customer") {
      response.status(403).json({ error: "Organizer access required" });
      return;
    }
    next();
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [salt, storedHex] = stored.split(":");
  if (!salt || !storedHex) return false;
  const storedKey = Buffer.from(storedHex, "hex");
  const suppliedKey = (await scrypt(password, salt, storedKey.length)) as Buffer;
  return storedKey.length === suppliedKey.length && timingSafeEqual(storedKey, suppliedKey);
}

export function createToken(session: Session) {
  return jwt.sign(session, config.jwtSecret, {
    expiresIn: "8h",
    issuer: "seatlock-api",
  });
}

export function requireAuth(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
) {
  const authorization = request.header("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    request.session = jwt.verify(
      authorization.slice("Bearer ".length),
      config.jwtSecret,
      { issuer: "seatlock-api" },
    ) as Session;
    next();
  } catch {
    response.status(401).json({ error: "Invalid or expired session" });
  }
}
