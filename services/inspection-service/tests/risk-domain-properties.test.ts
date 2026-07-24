/**
 * Property-based tests for risk scoring domain logic.
 *
 * **Property 6: Risk Factor Weight Validation** — validateWeightSum accepts
 * iff sum ∈ [0.999, 1.001].
 *
 * **Property 7: Risk Score Computation Bounds** — output always in [0, 100],
 * equals rounded weighted sum.
 *
 * Pure functions — no mocks, no I/O, no DB.
 *
 * **Validates: Requirements 3.1, 3.2, 3.8**
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  validateWeightSum,
  computeRiskScore,
  DomainError,
  type RiskFactor,
} from "../src/modules/risk/domain.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFactor(name: string, weight: number): RiskFactor {
  return { name, weight, scoringFunction: "linear", dataSource: "test" };
}

/**
 * Generates an array of factors whose weights sum to exactly `targetSum`.
 * Strategy: generate N-1 random proportions, normalize them to sum to targetSum.
 */
function factorsWithSum(targetSum: number): fc.Arbitrary<RiskFactor[]> {
  return fc
    .integer({ min: 1, max: 10 })
    .chain((n) =>
      fc.tuple(
        fc.array(fc.double({ min: 0.001, max: 1, noNaN: true, noDefaultInfinity: true }), {
          minLength: n,
          maxLength: n,
        }),
        fc.array(fc.string({ minLength: 1, maxLength: 10 }), {
          minLength: n,
          maxLength: n,
        }),
      ),
    )
    .map(([rawWeights, names]) => {
      const rawSum = rawWeights.reduce((a, b) => a + b, 0);
      return rawWeights.map((w, i) =>
        makeFactor(names[i] ?? `f${i}`, (w / rawSum) * targetSum),
      );
    });
}

// ── Property 6: Risk Factor Weight Validation ─────────────────────────────────

describe("Property 6: Risk Factor Weight Validation", () => {
  /**
   * **Validates: Requirements 3.1, 3.8**
   *
   * For any set of factors whose weights sum is within [0.999, 1.001],
   * validateWeightSum must accept (return true, not throw).
   */
  it("accepts when weight sum is within [0.999, 1.001]", () => {
    fc.assert(
      fc.property(
        factorsWithSum(1.0),
        (factors) => {
          // Factors generated with sum normalized to 1.0 — should always pass
          expect(() => validateWeightSum(factors)).not.toThrow();
          expect(validateWeightSum(factors)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.8**
   *
   * For any set of factors whose weights sum is below 0.999,
   * validateWeightSum must reject (throw DomainError with INVALID_WEIGHT_SUM).
   */
  it("rejects when weight sum is below 0.999", () => {
    fc.assert(
      fc.property(
        // Generate factors summing to a value in [0.0, 0.998]
        fc.double({ min: 0.01, max: 0.998, noNaN: true, noDefaultInfinity: true }).chain(
          (targetSum) => factorsWithSum(targetSum),
        ),
        (factors) => {
          expect(() => validateWeightSum(factors)).toThrow(DomainError);
          try {
            validateWeightSum(factors);
          } catch (e) {
            expect((e as DomainError).code).toBe("INVALID_WEIGHT_SUM");
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.8**
   *
   * For any set of factors whose weights sum is above 1.001,
   * validateWeightSum must reject (throw DomainError with INVALID_WEIGHT_SUM).
   */
  it("rejects when weight sum is above 1.001", () => {
    fc.assert(
      fc.property(
        // Generate factors summing to a value in [1.002, 2.0]
        fc.double({ min: 1.002, max: 2.0, noNaN: true, noDefaultInfinity: true }).chain(
          (targetSum) => factorsWithSum(targetSum),
        ),
        (factors) => {
          expect(() => validateWeightSum(factors)).toThrow(DomainError);
          try {
            validateWeightSum(factors);
          } catch (e) {
            expect((e as DomainError).code).toBe("INVALID_WEIGHT_SUM");
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.8**
   *
   * The biconditional: validateWeightSum accepts iff sum ∈ [0.999, 1.001].
   * For any set of factors, the function throws exactly when the sum is outside tolerance.
   */
  it("accepts iff sum ∈ [0.999, 1.001] (biconditional)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.double({ min: 0, max: 2, noNaN: true, noDefaultInfinity: true }),
          { minLength: 1, maxLength: 8 },
        ),
        (weights) => {
          const factors = weights.map((w, i) => makeFactor(`f${i}`, w));
          const sum = weights.reduce((a, b) => a + b, 0);
          const inTolerance = sum >= 0.999 && sum <= 1.001;

          if (inTolerance) {
            expect(() => validateWeightSum(factors)).not.toThrow();
          } else {
            expect(() => validateWeightSum(factors)).toThrow(DomainError);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});

// ── Property 7: Risk Score Computation Bounds ─────────────────────────────────

describe("Property 7: Risk Score Computation Bounds", () => {
  /**
   * **Validates: Requirements 3.2**
   *
   * For any valid model (weights summing to 1.0) and any raw scores in [0, 100],
   * computeRiskScore returns a score in [0, 100].
   */
  it("output is always in [0, 100] for valid inputs", () => {
    fc.assert(
      fc.property(
        factorsWithSum(1.0),
        fc.array(fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }), {
          minLength: 1,
          maxLength: 10,
        }),
        (factors, scores) => {
          const rawScores = new Map<string, number>();
          factors.forEach((f, i) => {
            rawScores.set(f.name, scores[i % scores.length]!);
          });

          const result = computeRiskScore(factors, rawScores);
          expect(result.score).toBeGreaterThanOrEqual(0);
          expect(result.score).toBeLessThanOrEqual(100);
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * **Validates: Requirements 3.2**
   *
   * For any valid model and any raw scores in [0, 100], the output equals
   * Math.round(Σ weight_i × rawScore_i), clamped to [0, 100].
   */
  it("equals rounded weighted sum clamped to [0, 100]", () => {
    fc.assert(
      fc.property(
        factorsWithSum(1.0),
        fc.array(fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }), {
          minLength: 1,
          maxLength: 10,
        }),
        (factors, scores) => {
          const rawScores = new Map<string, number>();
          factors.forEach((f, i) => {
            rawScores.set(f.name, scores[i % scores.length]!);
          });

          const result = computeRiskScore(factors, rawScores);

          // Independently compute expected score
          const expectedRaw = factors.reduce((acc, f) => {
            const raw = rawScores.get(f.name) ?? 0;
            return acc + f.weight * raw;
          }, 0);
          const expected = Math.max(0, Math.min(100, Math.round(expectedRaw)));

          expect(result.score).toBe(expected);
        },
      ),
      { numRuns: 500 },
    );
  });

  /**
   * **Validates: Requirements 3.2**
   *
   * The breakdown array has one entry per factor, and each entry's weightedScore
   * equals rawScore × weight for that factor.
   */
  it("breakdown contains correct per-factor weighted scores", () => {
    fc.assert(
      fc.property(
        factorsWithSum(1.0),
        fc.array(fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }), {
          minLength: 1,
          maxLength: 10,
        }),
        (factors, scores) => {
          const rawScores = new Map<string, number>();
          factors.forEach((f, i) => {
            rawScores.set(f.name, scores[i % scores.length]!);
          });

          const result = computeRiskScore(factors, rawScores);

          expect(result.breakdown).toHaveLength(factors.length);
          for (let i = 0; i < factors.length; i++) {
            const f = factors[i]!;
            const entry = result.breakdown[i]!;
            const expectedRaw = rawScores.get(f.name) ?? 0;
            expect(entry.factorName).toBe(f.name);
            expect(entry.rawScore).toBe(expectedRaw);
            expect(entry.weightedScore).toBeCloseTo(f.weight * expectedRaw, 10);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 3.2**
   *
   * Even with raw scores outside [0, 100], the output is still clamped to [0, 100].
   */
  it("clamps to [0, 100] even with out-of-range raw scores", () => {
    fc.assert(
      fc.property(
        factorsWithSum(1.0),
        fc.array(fc.double({ min: -500, max: 500, noNaN: true, noDefaultInfinity: true }), {
          minLength: 1,
          maxLength: 10,
        }),
        (factors, scores) => {
          const rawScores = new Map<string, number>();
          factors.forEach((f, i) => {
            rawScores.set(f.name, scores[i % scores.length]!);
          });

          const result = computeRiskScore(factors, rawScores);
          expect(result.score).toBeGreaterThanOrEqual(0);
          expect(result.score).toBeLessThanOrEqual(100);
        },
      ),
      { numRuns: 200 },
    );
  });
});
