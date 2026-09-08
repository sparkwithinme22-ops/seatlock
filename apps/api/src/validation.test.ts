import { describe, expect, it } from "vitest";
import { createEventInput, reservationInput } from "./validation.js";

const validRequest = {
  eventId: "10000000-0000-4000-8000-000000000001",
  seatId: "20000000-0000-4000-8000-000000000001",
  customerName: "Ada Lovelace",
  customerEmail: "ada@example.com",
};

describe("reservationInput", () => {
  it("accepts a complete reservation", () => {
    expect(reservationInput.safeParse(validRequest).success).toBe(true);
  });

  it("rejects an invalid email", () => {
    const result = reservationInput.safeParse({
      ...validRequest,
      customerEmail: "not-an-email",
    });
    expect(result.success).toBe(false);
  });
});

const validEvent = {
  name: "Indie Night",
  venue: "The Warehouse",
  startsAt: "2026-10-10T14:00:00.000Z",
  seatsPerRow: 10,
  pricingTiers: [
    { name: "VIP", rowCount: 2, priceRupees: 1200, color: "#8B5CF6" },
    { name: "Standard", rowCount: 3, priceRupees: 800, color: "#0EA5E9" },
  ],
};

describe("createEventInput", () => {
  it("accepts multiple pricing tiers", () => {
    expect(createEventInput.safeParse(validEvent).success).toBe(true);
  });

  it("rejects duplicate tier names regardless of case", () => {
    const result = createEventInput.safeParse({
      ...validEvent,
      pricingTiers: [
        validEvent.pricingTiers[0],
        { ...validEvent.pricingTiers[1], name: "vip" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects events with more than ten total rows", () => {
    const result = createEventInput.safeParse({
      ...validEvent,
      pricingTiers: validEvent.pricingTiers.map((tier) => ({ ...tier, rowCount: 6 })),
    });
    expect(result.success).toBe(false);
  });
});
