/**
 * Budget Allocation Domain — pure unit tests.
 *
 * Source: services/finance-service/src/modules/budget/allocation-domain.ts
 * Covers: appropriation available, over-appropriation guard, re-appropriation guard.
 */
import { describe, it, expect } from "vitest";
import {
  appropriationAvailable,
  assertWithinAppropriation,
  assertReappropriable,
} from "../src/modules/budget/allocation-domain.js";
import { DomainError } from "../src/modules/budget/domain.js";

describe("appropriationAvailable", () => {
  it("returns allocated minus committed+actual", () => {
    expect(appropriationAvailable({ allocatedMinor: 1_000_000n, committedMinor: 200_000n, actualMinor: 300_000n })).toBe(500_000n);
  });

  it("returns zero when fully utilised", () => {
    expect(appropriationAvailable({ allocatedMinor: 100n, committedMinor: 50n, actualMinor: 50n })).toBe(0n);
  });

  it("returns negative when over-committed", () => {
    expect(appropriationAvailable({ allocatedMinor: 100n, committedMinor: 60n, actualMinor: 60n })).toBe(-20n);
  });

  it("handles large amounts above 2^53 without precision loss", () => {
    const big = 10_000_000_000_000_000n;
    expect(appropriationAvailable({ allocatedMinor: big, committedMinor: 1n, actualMinor: 0n })).toBe(big - 1n);
  });
});

describe("assertWithinAppropriation", () => {
  // BUG FIX (misleading dead `enforce` flag, removed): Appropriation no
  // longer carries an `enforce` field — see the removal note above
  // setAllocBody in src/modules/budget/allocation-routes.ts for the full
  // history. The unconditional DB CHECK chk_allocation_no_overcommit already
  // made enforce=false inert everywhere except error presentation (a raw
  // PostgresError instead of the clean OVER_APPROPRIATION this function
  // throws), so it was removed rather than "fixed" to still look
  // configurable. Appropriation limits are now always enforced.
  const base = { allocatedMinor: 1_000_000n, committedMinor: 200_000n, actualMinor: 300_000n };

  it("passes when requested equals available (500_000)", () => {
    expect(() => assertWithinAppropriation(base, 500_000n)).not.toThrow();
  });

  it("passes when requested is less than available", () => {
    expect(() => assertWithinAppropriation(base, 1n)).not.toThrow();
  });

  it("throws OVER_APPROPRIATION when requested exceeds available by 1 paise", () => {
    expect(() => assertWithinAppropriation(base, 500_001n)).toThrow(DomainError);
    try { assertWithinAppropriation(base, 500_001n); } catch (e) {
      expect((e as DomainError).code).toBe("OVER_APPROPRIATION");
    }
  });

  it("zero requested always passes", () => {
    expect(() => assertWithinAppropriation(base, 0n)).not.toThrow();
  });
});

describe("assertReappropriable", () => {
  const source = { allocatedMinor: 1_000_000n, committedMinor: 200_000n, actualMinor: 300_000n };

  it("passes when amount equals available (500_000)", () => {
    expect(() => assertReappropriable(source, 500_000n)).not.toThrow();
  });

  it("throws INVALID_AMOUNT for zero", () => {
    expect(() => assertReappropriable(source, 0n)).toThrow(DomainError);
    try { assertReappropriable(source, 0n); } catch (e) { expect((e as DomainError).code).toBe("INVALID_AMOUNT"); }
  });

  it("throws INVALID_AMOUNT for negative", () => {
    expect(() => assertReappropriable(source, -1n)).toThrow(DomainError);
  });

  it("throws REAPPROPRIATION_EXCEEDS_BALANCE when exceeds available", () => {
    expect(() => assertReappropriable(source, 500_001n)).toThrow(DomainError);
    try { assertReappropriable(source, 500_001n); } catch (e) {
      expect((e as DomainError).code).toBe("REAPPROPRIATION_EXCEEDS_BALANCE");
    }
  });
});
