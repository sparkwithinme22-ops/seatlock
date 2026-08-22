import { describe, expect, it } from "vitest";
import { reservationInput } from "./validation.js";

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
