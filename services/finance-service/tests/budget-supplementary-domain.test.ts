/**
 * Budget Supplementary Domain — pure unit tests.
 *
 * Source: services/finance-service/src/modules/budget/supplementary-domain.ts
 * Covers: kind validation, supplementary input validation, state machine,
 * maker-checker, availability calculation.
 */
import { describe, it, expect } from "vitest";
import {
  assertValidSupplementaryKind,
  assertSupplementaryValid,
  assertSupplementaryApproverDistinct,
  assertSupplementaryTransition,
  availabilityAfterSupplementary,
} from "../src/modules/budget/supplementary-domain.js";
import { DomainError } from "../src/modules/budget/domain.js";

describe("assertValidSupplementaryKind", () => {
  it.each(["supplementary", "additional", "excess"])("accepts valid kind: %s", (kind) => {
    expect(() => assertValidSupplementaryKind(kind)).not.toThrow();
  });

  it("throws INVALID_KIND for unknown kind", () => {
    expect(() => assertValidSupplementaryKind("token")).toThrow(DomainError);
    try { assertValidSupplementaryKind("foo"); } catch (e) { expect((e as DomainError).code).toBe("INVALID_KIND"); }
  });
});

describe("assertSupplementaryValid", () => {
  it("passes for valid input within limit", () => {
    expect(() => assertSupplementaryValid({
      amountMinor: 100_000n, authority: "Finance Secretary", limitMinor: 200_000n,
    })).not.toThrow();
  });

  it("passes at exactly the limit (boundary)", () => {
    expect(() => assertSupplementaryValid({
      amountMinor: 200_000n, authority: "Finance Secretary", limitMinor: 200_000n,
    })).not.toThrow();
  });

  it("passes when limitMinor is 0 (no cap)", () => {
    expect(() => assertSupplementaryValid({
      amountMinor: 999_999_999n, authority: "Cabinet", limitMinor: 0n,
    })).not.toThrow();
  });

  it("passes when limitMinor is negative (no cap)", () => {
    expect(() => assertSupplementaryValid({
      amountMinor: 999_999_999n, authority: "Cabinet", limitMinor: -1n,
    })).not.toThrow();
  });

  it("throws INVALID_AMOUNT for zero amount", () => {
    expect(() => assertSupplementaryValid({ amountMinor: 0n, authority: "FS", limitMinor: 0n })).toThrow(DomainError);
    try { assertSupplementaryValid({ amountMinor: 0n, authority: "FS", limitMinor: 0n }); } catch (e) {
      expect((e as DomainError).code).toBe("INVALID_AMOUNT");
    }
  });

  it("throws MISSING_AUTHORITY for empty authority", () => {
    expect(() => assertSupplementaryValid({ amountMinor: 100n, authority: "", limitMinor: 0n })).toThrow(DomainError);
    try { assertSupplementaryValid({ amountMinor: 100n, authority: "  ", limitMinor: 0n }); } catch (e) {
      expect((e as DomainError).code).toBe("MISSING_AUTHORITY");
    }
  });

  it("throws LIMIT_EXCEEDED when amount > positive limit", () => {
    expect(() => assertSupplementaryValid({ amountMinor: 200_001n, authority: "FS", limitMinor: 200_000n })).toThrow(DomainError);
    try { assertSupplementaryValid({ amountMinor: 200_001n, authority: "FS", limitMinor: 200_000n }); } catch (e) {
      expect((e as DomainError).code).toBe("LIMIT_EXCEEDED");
    }
  });
});

describe("assertSupplementaryApproverDistinct (maker-checker)", () => {
  it("passes for different officers", () => {
    expect(() => assertSupplementaryApproverDistinct("a", "b")).not.toThrow();
  });

  it("throws MAKER_CHECKER_VIOLATION for same officer", () => {
    expect(() => assertSupplementaryApproverDistinct("a", "a")).toThrow(DomainError);
  });
});

describe("assertSupplementaryTransition (state machine)", () => {
  it("pending_approval → approved", () => { expect(() => assertSupplementaryTransition("pending_approval", "approved")).not.toThrow(); });
  it("pending_approval → rejected", () => { expect(() => assertSupplementaryTransition("pending_approval", "rejected")).not.toThrow(); });

  it("approved is terminal", () => {
    expect(() => assertSupplementaryTransition("approved", "pending_approval")).toThrow(DomainError);
    expect(() => assertSupplementaryTransition("approved", "rejected")).toThrow(DomainError);
  });

  it("rejected is terminal", () => {
    expect(() => assertSupplementaryTransition("rejected", "pending_approval")).toThrow(DomainError);
    expect(() => assertSupplementaryTransition("rejected", "approved")).toThrow(DomainError);
  });
});

describe("availabilityAfterSupplementary", () => {
  it("returns (RE + supplement) - utilised", () => {
    expect(availabilityAfterSupplementary(1_000_000n, 300_000n, 200_000n)).toBe(900_000n);
  });

  it("can return negative if over-utilised despite supplement", () => {
    expect(availabilityAfterSupplementary(100n, 500n, 50n)).toBe(-350n);
  });

  it("returns the supplement amount itself when RE and utilised are both zero", () => {
    expect(availabilityAfterSupplementary(0n, 0n, 500_000n)).toBe(500_000n);
  });
});
