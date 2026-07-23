/**
 * Unit tests for risk scoring domain logic.
 * Pure functions — no mocks, no I/O, no DB.
 *
 * Validates: Requirements 3.1, 3.2, 3.8
 */
import { describe, it, expect } from "vitest";
import {
  validateWeightSum,
  computeRiskScore,
  DomainError,
  type RiskFactor,
} from "../src/modules/risk/domain.js";

// ── Test Helpers ──────────────────────────────────────────────────────────────

function makeFactor(name: string, weight: number): RiskFactor {
  return { name, weight, scoringFunction: "linear", dataSource: "test" };
}

// ── validateWeightSum ─────────────────────────────────────────────────────────

describe("validateWeightSum", () => {
  it("returns true when weights sum to exactly 1.0", () => {
    const factors = [makeFactor("a", 0.5), makeFactor("b", 0.5)];
    expect(validateWeightSum(factors)).toBe(true);
  });

  it("returns true when weights sum within tolerance (0.999)", () => {
    const factors = [makeFactor("a", 0.333), makeFactor("b", 0.333), makeFactor("c", 0.333)];
    expect(validateWeightSum(factors)).toBe(true);
  });

  it("returns true when weights sum within tolerance (1.001)", () => {
    const factors = [makeFactor("a", 0.5005), makeFactor("b", 0.5005)];
    expect(validateWeightSum(factors)).toBe(true);
  });

  it("throws DomainError when weights sum to less than 0.999", () => {
    const factors = [makeFactor("a", 0.3), makeFactor("b", 0.3)];
    expect(() => validateWeightSum(factors)).toThrow(DomainError);
    expect(() => validateWeightSum(factors)).toThrow("must sum to 1.0");
  });

  it("throws DomainError when weights sum to more than 1.001", () => {
    const factors = [makeFactor("a", 0.6), makeFactor("b", 0.6)];
    expect(() => validateWeightSum(factors)).toThrow(DomainError);
  });

  it("DomainError has code INVALID_WEIGHT_SUM", () => {
    const factors = [makeFactor("a", 0.1)];
    try {
      validateWeightSum(factors);
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("INVALID_WEIGHT_SUM");
    }
  });

  it("handles empty factors array (sum = 0, throws)", () => {
    expect(() => validateWeightSum([])).toThrow(DomainError);
  });
});

// ── computeRiskScore ──────────────────────────────────────────────────────────

describe("computeRiskScore", () => {
  it("computes a weighted sum correctly", () => {
    const factors = [makeFactor("a", 0.6), makeFactor("b", 0.4)];
    const rawScores = new Map([["a", 80], ["b", 50]]);
    const result = computeRiskScore(factors, rawScores);

    // 0.6*80 + 0.4*50 = 48 + 20 = 68
    expect(result.score).toBe(68);
    expect(result.breakdown).toHaveLength(2);
    expect(result.breakdown[0]).toEqual({ factorName: "a", rawScore: 80, weightedScore: 48 });
    expect(result.breakdown[1]).toEqual({ factorName: "b", rawScore: 50, weightedScore: 20 });
  });

  it("treats missing raw scores as 0", () => {
    const factors = [makeFactor("a", 0.5), makeFactor("b", 0.5)];
    const rawScores = new Map([["a", 60]]);
    const result = computeRiskScore(factors, rawScores);

    // 0.5*60 + 0.5*0 = 30 + 0 = 30
    expect(result.score).toBe(30);
    expect(result.breakdown[1]).toEqual({ factorName: "b", rawScore: 0, weightedScore: 0 });
  });

  it("clamps score to minimum 0", () => {
    const factors = [makeFactor("a", 1.0)];
    const rawScores = new Map([["a", -50]]);
    const result = computeRiskScore(factors, rawScores);

    expect(result.score).toBe(0);
  });

  it("clamps score to maximum 100", () => {
    const factors = [makeFactor("a", 1.0)];
    const rawScores = new Map([["a", 150]]);
    const result = computeRiskScore(factors, rawScores);

    expect(result.score).toBe(100);
  });

  it("rounds the final score to the nearest integer", () => {
    const factors = [makeFactor("a", 0.3), makeFactor("b", 0.7)];
    const rawScores = new Map([["a", 33], ["b", 67]]);
    const result = computeRiskScore(factors, rawScores);

    // 0.3*33 + 0.7*67 = 9.9 + 46.9 = 56.8 → rounds to 57
    expect(result.score).toBe(57);
  });

  it("returns score 0 when all raw scores are 0", () => {
    const factors = [makeFactor("a", 0.5), makeFactor("b", 0.5)];
    const rawScores = new Map([["a", 0], ["b", 0]]);
    const result = computeRiskScore(factors, rawScores);

    expect(result.score).toBe(0);
  });

  it("returns score 100 when all raw scores are 100 and weights sum to 1", () => {
    const factors = [makeFactor("a", 0.5), makeFactor("b", 0.5)];
    const rawScores = new Map([["a", 100], ["b", 100]]);
    const result = computeRiskScore(factors, rawScores);

    expect(result.score).toBe(100);
  });

  it("handles single factor correctly", () => {
    const factors = [makeFactor("only", 1.0)];
    const rawScores = new Map([["only", 73]]);
    const result = computeRiskScore(factors, rawScores);

    expect(result.score).toBe(73);
    expect(result.breakdown).toHaveLength(1);
  });
});
