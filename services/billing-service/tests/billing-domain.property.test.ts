/**
 * Property-Based Tests for Billing Domain (Revenue Recognition & Proration).
 * Uses fast-check to verify invariants hold across all valid inputs.
 *
 * Property 25: Revenue Recognition Sum Invariant
 * Property 26: Mid-Cycle Proration Computation
 * **Validates: Requirements 13.1, 13.2, 13.3**
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  dailyAccruals,
  computeDeferredBalance,
} from "../src/modules/revenue/domain.js";
import {
  prorationCredit,
  prorationCharge,
  computeProration,
} from "../src/modules/proration/domain.js";

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Total amount in paise (bigint): 0 to 100 crore (1 billion paise) */
const totalPaiseArb: fc.Arbitrary<bigint> = fc.bigInt({
  min: 0n,
  max: 1_000_000_000n,
});

/** Positive total amount in paise (bigint): 1 to 100 crore */
const positivePaiseArb: fc.Arbitrary<bigint> = fc.bigInt({
  min: 1n,
  max: 1_000_000_000n,
});

/** Number of days in a billing period: 1 to 366 (covers leap year) */
const totalDaysArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 366 });

/** Days remaining in a billing cycle (0 to totalDays) */
function daysRemainingArb(totalDays: number): fc.Arbitrary<number> {
  return fc.integer({ min: 0, max: totalDays });
}

/** Plan price in paise: 0 to 100 crore */
const planPaiseArb: fc.Arbitrary<bigint> = fc.bigInt({
  min: 0n,
  max: 1_000_000_000n,
});

/** Positive plan price in paise: 1 to 100 crore */
const positivePlanPaiseArb: fc.Arbitrary<bigint> = fc.bigInt({
  min: 1n,
  max: 1_000_000_000n,
});

// ─── Property 25: Revenue Recognition Sum Invariant ───────────────────────────

describe("Property 25: Revenue Recognition Sum Invariant", () => {
  /**
   * For any total amount (bigint paise) and number of days in a billing period,
   * the sum of all daily accruals must equal the total amount exactly.
   * No paise lost or gained.
   *
   * **Validates: Requirements 13.1, 13.2**
   */
  it("sum of all daily accruals equals total amount exactly (no paise lost or gained)", () => {
    fc.assert(
      fc.property(totalPaiseArb, totalDaysArb, (totalPaise, totalDays) => {
        const accruals = dailyAccruals(totalPaise, totalDays);
        const sum = accruals.reduce((acc, val) => acc + val, 0n);
        expect(sum).toBe(totalPaise);
      }),
      { numRuns: 1000 },
    );
  });

  /**
   * Each daily accrual is floor(total/days), with the remainder added to the last day.
   * For days 0..N-2, accrual[i] === floor(total/days).
   * For day N-1 (last), accrual[N-1] === floor(total/days) + remainder.
   *
   * **Validates: Requirements 13.1, 13.2**
   */
  it("each daily accrual is floor(total/days), remainder goes to last day", () => {
    fc.assert(
      fc.property(positivePaiseArb, totalDaysArb, (totalPaise, totalDays) => {
        const accruals = dailyAccruals(totalPaise, totalDays);
        const bigDays = BigInt(totalDays);
        const expectedDaily = totalPaise / bigDays;
        const expectedRemainder = totalPaise - expectedDaily * bigDays;

        // All days except last get floor(total/days)
        for (let i = 0; i < totalDays - 1; i++) {
          expect(accruals[i]).toBe(expectedDaily);
        }
        // Last day gets floor(total/days) + remainder
        expect(accruals[totalDays - 1]).toBe(expectedDaily + expectedRemainder);
      }),
      { numRuns: 1000 },
    );
  });

  /**
   * All daily accruals are non-negative (since totalPaise >= 0).
   *
   * **Validates: Requirements 13.1, 13.2**
   */
  it("all daily accruals are non-negative", () => {
    fc.assert(
      fc.property(totalPaiseArb, totalDaysArb, (totalPaise, totalDays) => {
        const accruals = dailyAccruals(totalPaise, totalDays);
        for (const accrual of accruals) {
          expect(accrual).toBeGreaterThanOrEqual(0n);
        }
      }),
      { numRuns: 1000 },
    );
  });

  /**
   * The last day's accrual is always >= any other day's accrual,
   * because it absorbs the non-negative remainder from integer division.
   *
   * **Validates: Requirements 13.1, 13.2**
   */
  it("last day accrual >= other day accruals (absorbs remainder)", () => {
    fc.assert(
      fc.property(totalPaiseArb, totalDaysArb, (totalPaise, totalDays) => {
        const accruals = dailyAccruals(totalPaise, totalDays);
        const lastDayAccrual = accruals[totalDays - 1]!;
        for (let i = 0; i < totalDays - 1; i++) {
          expect(lastDayAccrual).toBeGreaterThanOrEqual(accruals[i]!);
        }
      }),
      { numRuns: 1000 },
    );
  });

  /**
   * Deferred revenue starts at total and decreases to 0 after all accruals.
   * At any point: recognized + deferred === total.
   *
   * **Validates: Requirements 13.1, 13.2**
   */
  it("deferred revenue starts at total and decreases to 0 (invariant holds at each day)", () => {
    fc.assert(
      fc.property(positivePaiseArb, totalDaysArb, (totalPaise, totalDays) => {
        const accruals = dailyAccruals(totalPaise, totalDays);

        let recognized = 0n;
        // Before any recognition, deferred = total
        expect(computeDeferredBalance(totalPaise, recognized)).toBe(totalPaise);

        for (let i = 0; i < totalDays; i++) {
          recognized += accruals[i]!;
          const deferred = computeDeferredBalance(totalPaise, recognized);
          // Invariant: recognized + deferred === total at every step
          expect(recognized + deferred).toBe(totalPaise);
          // Deferred is non-negative
          expect(deferred).toBeGreaterThanOrEqual(0n);
        }

        // After all days, fully recognized
        expect(recognized).toBe(totalPaise);
        expect(computeDeferredBalance(totalPaise, recognized)).toBe(0n);
      }),
      { numRuns: 500 },
    );
  });
});

// ─── Property 26: Mid-Cycle Proration Computation ─────────────────────────────

describe("Property 26: Mid-Cycle Proration Computation", () => {
  /**
   * Credit equals floor(daysRemaining / totalDays × oldPlanPrice) via bigint floor division.
   *
   * **Validates: Requirements 13.3**
   */
  it("credit = floor(daysRemaining * oldPlanPrice / totalDays)", () => {
    fc.assert(
      fc.property(
        totalDaysArb,
        fc.integer({ min: 1, max: 366 }),
        planPaiseArb,
        (totalDays, rawDaysRemaining, oldPlanPaise) => {
          const daysRemaining = Math.min(rawDaysRemaining, totalDays);
          const credit = prorationCredit(daysRemaining, totalDays, oldPlanPaise);
          const expected = (BigInt(daysRemaining) * oldPlanPaise) / BigInt(totalDays);
          expect(credit).toBe(expected);
        },
      ),
      { numRuns: 1000 },
    );
  });

  /**
   * Charge equals floor(daysRemaining / totalDays × newPlanPrice) via bigint floor division.
   *
   * **Validates: Requirements 13.3**
   */
  it("charge = floor(daysRemaining * newPlanPrice / totalDays)", () => {
    fc.assert(
      fc.property(
        totalDaysArb,
        fc.integer({ min: 1, max: 366 }),
        planPaiseArb,
        (totalDays, rawDaysRemaining, newPlanPaise) => {
          const daysRemaining = Math.min(rawDaysRemaining, totalDays);
          const charge = prorationCharge(daysRemaining, totalDays, newPlanPaise);
          const expected = (BigInt(daysRemaining) * newPlanPaise) / BigInt(totalDays);
          expect(charge).toBe(expected);
        },
      ),
      { numRuns: 1000 },
    );
  });

  /**
   * Both credit and charge are non-negative (bigint paise) for any valid inputs.
   *
   * **Validates: Requirements 13.3**
   */
  it("both credit and charge are non-negative", () => {
    fc.assert(
      fc.property(
        totalDaysArb,
        fc.integer({ min: 0, max: 366 }),
        planPaiseArb,
        planPaiseArb,
        (totalDays, rawDaysRemaining, oldPlanPaise, newPlanPaise) => {
          const daysRemaining = Math.min(rawDaysRemaining, totalDays);
          const result = computeProration({
            daysRemaining,
            totalDays,
            oldPlanPaise,
            newPlanPaise,
          });
          expect(result.credit).toBeGreaterThanOrEqual(0n);
          expect(result.charge).toBeGreaterThanOrEqual(0n);
        },
      ),
      { numRuns: 1000 },
    );
  });

  /**
   * Credit never exceeds the old plan price.
   * Since daysRemaining <= totalDays, floor(daysRemaining * oldPlan / totalDays) <= oldPlan.
   *
   * **Validates: Requirements 13.3**
   */
  it("credit never exceeds the old plan price", () => {
    fc.assert(
      fc.property(
        totalDaysArb,
        fc.integer({ min: 0, max: 366 }),
        planPaiseArb,
        (totalDays, rawDaysRemaining, oldPlanPaise) => {
          const daysRemaining = Math.min(rawDaysRemaining, totalDays);
          const credit = prorationCredit(daysRemaining, totalDays, oldPlanPaise);
          expect(credit).toBeLessThanOrEqual(oldPlanPaise);
        },
      ),
      { numRuns: 1000 },
    );
  });

  /**
   * Charge never exceeds the new plan price.
   * Since daysRemaining <= totalDays, floor(daysRemaining * newPlan / totalDays) <= newPlan.
   *
   * **Validates: Requirements 13.3**
   */
  it("charge never exceeds the new plan price", () => {
    fc.assert(
      fc.property(
        totalDaysArb,
        fc.integer({ min: 0, max: 366 }),
        planPaiseArb,
        (totalDays, rawDaysRemaining, newPlanPaise) => {
          const daysRemaining = Math.min(rawDaysRemaining, totalDays);
          const charge = prorationCharge(daysRemaining, totalDays, newPlanPaise);
          expect(charge).toBeLessThanOrEqual(newPlanPaise);
        },
      ),
      { numRuns: 1000 },
    );
  });
});
