import { z } from "zod";

export const reservationInput = z.object({
  eventId: z.uuid(),
  seatId: z.uuid(),
  customerName: z.string().trim().min(2).max(100).optional(),
  customerEmail: z.email().optional(),
});

export type ReservationInput = z.infer<typeof reservationInput>;
export const idempotencyKeyInput = z.uuid();

export const registerInput = z.object({
  accountType: z.enum(["customer", "organizer"]).default("customer"),
  organizationName: z.string().trim().min(2).max(100).optional(),
  name: z.string().trim().min(2).max(100),
  email: z.email(),
  password: z.string().min(10).max(200),
}).superRefine((value, context) => {
  if (value.accountType === "organizer" && !value.organizationName) {
    context.addIssue({ code: "custom", path: ["organizationName"], message: "Organization name is required" });
  }
});

export const loginInput = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
});

export const createEventInput = z.object({
  name: z.string().trim().min(3).max(120),
  venue: z.string().trim().min(2).max(160),
  startsAt: z.iso.datetime(),
  seatsPerRow: z.number().int().min(1).max(30),
  pricingTiers: z.array(z.object({
    name: z.string().trim().min(2).max(40),
    rowCount: z.number().int().min(1).max(10),
    priceRupees: z.number().int().min(0).max(1_000_000),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  })).min(1).max(5),
}).superRefine((value, context) => {
  const totalRows = value.pricingTiers.reduce((sum, tier) => sum + tier.rowCount, 0);
  if (totalRows > 10) {
    context.addIssue({ code: "custom", path: ["pricingTiers"], message: "An event can have at most 10 rows" });
  }
  const names = value.pricingTiers.map((tier) => tier.name.toLowerCase());
  if (new Set(names).size !== names.length) {
    context.addIssue({ code: "custom", path: ["pricingTiers"], message: "Pricing tier names must be unique" });
  }
});

export type CreateEventInput = z.infer<typeof createEventInput>;
