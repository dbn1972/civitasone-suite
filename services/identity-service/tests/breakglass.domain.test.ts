import { describe, it, expect } from "vitest";
import {
  assertTtl, expiryFromNow, canTransition, isInForce,
  MIN_TTL_MINUTES, MAX_TTL_MINUTES, DomainError,
} from "../src/modules/breakglass/domain.js";

describe("break-glass domain — TTL bounds", () => {
  it("accepts TTL within [MIN, MAX]", () => {
    expect(() => assertTtl(MIN_TTL_MINUTES)).not.toThrow();
    expect(() => assertTtl(60)).not.toThrow();
    expect(() => assertTtl(MAX_TTL_MINUTES)).not.toThrow();
  });
  it("rejects TTL outside bounds or non-integer", () => {
    for (const t of [0, MIN_TTL_MINUTES - 1, MAX_TTL_MINUTES + 1, 4.5]) {
      try { assertTtl(t); throw new Error("should throw for " + t); }
      catch (e) { expect(e).toBeInstanceOf(DomainError); expect((e as DomainError).code).toBe("INVALID_TTL"); }
    }
  });
  it("computes expiry from now + ttl", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(expiryFromNow(30, now).toISOString()).toBe("2026-01-01T00:30:00.000Z");
  });
});

describe("break-glass domain — lifecycle + in-force", () => {
  it("active → closed|expired; both terminal", () => {
    expect(canTransition("active", "closed")).toBe(true);
    expect(canTransition("active", "expired")).toBe(true);
    expect(canTransition("closed", "active")).toBe(false);
    expect(canTransition("expired", "closed")).toBe(false);
  });
  it("isInForce only for active + unexpired", () => {
    expect(isInForce("active", new Date(Date.now() + 60_000))).toBe(true);
    expect(isInForce("active", new Date(Date.now() - 60_000))).toBe(false);
    expect(isInForce("closed", new Date(Date.now() + 60_000))).toBe(false);
  });
});
