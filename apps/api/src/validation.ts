import { z } from "zod";

export const reservationInput = z.object({
  eventId: z.uuid(),
  seatId: z.uuid(),
  customerName: z.string().trim().min(2).max(100),
  customerEmail: z.email(),
});

export type ReservationInput = z.infer<typeof reservationInput>;
export const idempotencyKeyInput = z.uuid();

export const registerInput = z.object({
  organizationName: z.string().trim().min(2).max(100),
  name: z.string().trim().min(2).max(100),
  email: z.email(),
  password: z.string().min(10).max(200),
});

export const loginInput = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
});

export const createEventInput = z.object({
  name: z.string().trim().min(3).max(120),
  venue: z.string().trim().min(2).max(160),
  startsAt: z.iso.datetime(),
  rows: z.number().int().min(1).max(10),
  seatsPerRow: z.number().int().min(1).max(30),
  priceRupees: z.number().int().min(0).max(1_000_000),
});
