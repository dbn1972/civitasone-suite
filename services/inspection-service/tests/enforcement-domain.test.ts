/**
 * Unit tests for Enforcement domain logic.
 * Pure functions — no mocks, no I/O, no DB.
 *
 * Validates: SVC-107
 */
import { describe, it, expect } from "vitest";
import {
  PENALTY_ORDER_STATES,
  PENALTY_ORDER_TRANSITIONS,
  assertValidPenaltyOrderTransition,
  assertMakerChecker,
  lookupEffectiveRate,
  validateAmount,
  DomainError,
  type RateRecord,
} from "../src/modules/enforcement/domain.js";

// ── Constants ─────────────────────────────────────────────────────────────────

describe("PENALTY_ORDER_STATES", () => {
  it("contains exactly 5 states", () => {
    expect(PENALTY_ORDER_STATES).toHaveLength(5);
  });

  it("includes all expected states", () => {
    expect(PENALTY_ORDER_STATES).toContain("draft");
    expect(PENALTY_ORDER_STATES).toContain("issued");
    expect(PENALTY_ORDER_STATES).toContain("paid");
    expect(PENALTY_ORDER_STATES).toContain("waived");
    expect(PENALTY_ORDER_STATES).toContain("appealed");
  });
});

describe("PENALTY_ORDER_TRANSITIONS", () => {
  it("allows draft → issued", () => {
    expect(PENALTY_ORDER_TRANSITIONS.draft).toContain("issued");
  });

  it("allows issued → paid, waived, appealed", () => {
    expect(PENALTY_ORDER_TRANSITIONS.issued).toContain("paid");
    expect(PENALTY_ORDER_TRANSITIONS.issued).toContain("waived");
    expect(PENALTY_ORDER_TRANSITIONS.issued).toContain("appealed");
  });

  it("paid is terminal", () => {
    expect(PENALTY_ORDER_TRANSITIONS.paid).toHaveLength(0);
  });

  it("waived is terminal", () => {
    expect(PENALTY_ORDER_TRANSITIONS.waived).toHaveLength(0);
  });

  it("appealed is terminal", () => {
    expect(PENALTY_ORDER_TRANSITIONS.appealed).toHaveLength(0);
  });
});

// ── assertValidPenaltyOrderTransition ─────────────────────────────────────────

describe("assertValidPenaltyOrderTransition", () => {
  it("does not throw for draft → issued", () => {
    expect(() => assertValidPenaltyOrderTransition("draft", "issued"))
      .not.toThrow();
  });

  it("does not throw for issued → paid", () => {
    expect(() => assertValidPenaltyOrderTransition("issued", "paid"))
      .not.toThrow();
  });

  it("does not throw for issued → waived", () => {
    expect(() => assertValidPenaltyOrderTransition("issued", "waived"))
      .not.toThrow();
  });

  it("does not throw for issued → appealed", () => {
    expect(() => assertValidPenaltyOrderTransition("issued", "appealed"))
      .not.toThrow();
  });

  it("throws for draft → paid (must be issued first)", () => {
    expect(() => assertValidPenaltyOrderTransition("draft", "paid"))
      .toThrow(DomainError);
  });

  it("throws for paid → issued (terminal state)", () => {
    expect(() => assertValidPenaltyOrderTransition("paid", "issued"))
      .toThrow(DomainError);
  });

  it("throws for waived → draft (terminal state)", () => {
    expect(() => assertValidPenaltyOrderTransition("waived", "draft"))
      .toThrow(DomainError);
  });

  it("error code is INVALID_TRANSITION", () => {
    try {
      assertValidPenaltyOrderTransition("paid", "draft");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("INVALID_TRANSITION");
    }
  });
});

// ── assertMakerChecker ────────────────────────────────────────────────────────

describe("assertMakerChecker", () => {
  it("does not throw when maker and checker are different", () => {
    expect(() => assertMakerChecker("user-maker", "user-checker"))
      .not.toThrow();
  });

  it("throws MAKER_CHECKER_VIOLATION when same user", () => {
    try {
      assertMakerChecker("same-user", "same-user");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("MAKER_CHECKER_VIOLATION");
    }
  });

  it("error message mentions maker", () => {
    expect(() => assertMakerChecker("user-a", "user-a"))
      .toThrow("maker");
  });
});

// ── lookupEffectiveRate ───────────────────────────────────────────────────────

describe("lookupEffectiveRate", () => {
  const rates: RateRecord[] = [
    { effectiveFrom: "2024-01-01", effectiveTo: "2024-06-30", amount: 100000n, isActive: true },
    { effectiveFrom: "2024-07-01", effectiveTo: null, amount: 150000n, isActive: true },
    { effectiveFrom: "2023-01-01", effectiveTo: "2023-12-31", amount: 80000n, isActive: false },
  ];

  it("finds rate when date is within range", () => {
    const result = lookupEffectiveRate(rates, "2024-03-15");
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(100000n);
  });

  it("finds open-ended rate (effectiveTo null)", () => {
    const result = lookupEffectiveRate(rates, "2025-01-01");
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(150000n);
  });

  it("returns null when no rate matches", () => {
    const result = lookupEffectiveRate(rates, "2022-06-01");
    expect(result).toBeNull();
  });

  it("skips inactive rates", () => {
    const result = lookupEffectiveRate(rates, "2023-06-15");
    expect(result).toBeNull();
  });

  it("returns null for empty rates array", () => {
    expect(lookupEffectiveRate([], "2024-01-01")).toBeNull();
  });
});

// ── validateAmount ────────────────────────────────────────────────────────────

describe("validateAmount", () => {
  it("does not throw for positive bigint", () => {
    expect(() => validateAmount(100n)).not.toThrow();
    expect(() => validateAmount(1n)).not.toThrow();
    expect(() => validateAmount(999999999999n)).not.toThrow();
  });

  it("throws INVALID_AMOUNT for zero", () => {
    try {
      validateAmount(0n);
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("INVALID_AMOUNT");
    }
  });

  it("throws INVALID_AMOUNT for negative bigint", () => {
    expect(() => validateAmount(-1n)).toThrow(DomainError);
    expect(() => validateAmount(-100000n)).toThrow(DomainError);
  });
});
