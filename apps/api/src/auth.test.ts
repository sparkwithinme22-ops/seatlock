import { describe, expect, it } from "vitest";
import { createToken, hashPassword, verifyPassword } from "./auth.js";

describe("password security", () => {
  it("verifies the correct password and rejects another", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(await verifyPassword("wrong password", stored)).toBe(false);
  });

  it("uses a unique salt for each stored password", async () => {
    const first = await hashPassword("same password");
    const second = await hashPassword("same password");
    expect(first).not.toBe(second);
  });
});

describe("sessions", () => {
  it("creates a signed JWT", () => {
    const token = createToken({
      userId: "10000000-0000-4000-8000-000000000001",
      organizerId: "20000000-0000-4000-8000-000000000001",
      role: "owner",
    });
    expect(token.split(".")).toHaveLength(3);
  });
});

