/**
 * masters/domain.ts — unit tests for opening-balance balance validation.
 *
 * Mirrors gl-domain.test.ts's coverage style for the analogous GL journal
 * check. Proves the integrity fix: a direct-API-call-shaped unbalanced entry
 * set is rejected with a clear, typed error before anything is inserted.
 *
 * Source: services/finance-service/src/modules/masters/domain.ts
 */
import { describe, it, expect } from "vitest";
import { assertOpeningBalancesBalanced, DomainError } from "../src/modules/masters/domain.js";

function entry(accountCode: string, debitMinor: number | bigint, creditMinor: number | bigint) {
  return { accountCode, debitMinor, creditMinor };
}

describe("assertOpeningBalancesBalanced — balanced sets pass", () => {
  it("simple 2-entry balanced set", () => {
    expect(() => assertOpeningBalancesBalanced([
      entry("1100", 500000, 0),
      entry("3100", 0, 500000),
    ])).not.toThrow();
  });

  it("multi-entry balanced set (5 entries)", () => {
    expect(() => assertOpeningBalancesBalanced([
      entry("1100", 300000, 0),
      entry("1200", 200000, 0),
      entry("3100", 0, 150000),
      entry("3200", 0, 150000),
      entry("3300", 0, 200000),
    ])).not.toThrow();
  });

  it("all-zero entries balance trivially", () => {
    expect(() => assertOpeningBalancesBalanced([
      entry("1100", 0, 0),
      entry("3100", 0, 0),
    ])).not.toThrow();
  });

  it("large paise amounts beyond 2^53 still balance correctly (bigint, not float)", () => {
    const big = 9_007_199_254_740_993n; // > Number.MAX_SAFE_INTEGER
    expect(() => assertOpeningBalancesBalanced([
      entry("1100", big, 0n),
      entry("3100", 0n, big),
    ])).not.toThrow();
  });
});

describe("assertOpeningBalancesBalanced — unbalanced sets are rejected", () => {
  it("rejects a direct-API-call-shaped unbalanced pair (short credit)", () => {
    expect(() => assertOpeningBalancesBalanced([
      entry("1100", 100000, 0),
      entry("3100", 0, 90000), // 10000 short -- the client-side guard this bypasses would have blocked it
    ])).toThrow(DomainError);
  });

  it("throws DomainError with code OPENING_BALANCE_UNBALANCED and the exact mismatch in the message", () => {
    try {
      assertOpeningBalancesBalanced([
        entry("1100", 100000, 0),
        entry("3100", 0, 90000),
      ]);
      expect.unreachable("expected assertOpeningBalancesBalanced to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("OPENING_BALANCE_UNBALANCED");
      expect((err as DomainError).message).toContain("100000");
      expect((err as DomainError).message).toContain("90000");
    }
  });

  it("rejects when credits exceed debits", () => {
    expect(() => assertOpeningBalancesBalanced([
      entry("1100", 50000, 0),
      entry("3100", 0, 60000),
    ])).toThrow(DomainError);
  });

  it("rejects a single unbalanced entry with only a debit", () => {
    expect(() => assertOpeningBalancesBalanced([
      entry("1100", 100000, 0),
    ])).toThrow(DomainError);
  });

  it("a forged multi-entry set that nets balanced per-account but is fine (only the GRAND total matters)", () => {
    // Sanity check the invariant is a pure sum, not a per-account reconciliation --
    // opening balances legitimately span many unrelated accounts.
    expect(() => assertOpeningBalancesBalanced([
      entry("1100", 700000, 0),
      entry("3100", 0, 300000),
      entry("3200", 0, 400000),
    ])).not.toThrow();
  });
});
