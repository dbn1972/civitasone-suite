/**
 * Boundary condition tests for Lead Scoring and Forecast Computation.
 *
 * Tests zero attributes, all-zero weights, max score overflow,
 * empty deals array, probability = 0, probability = 100.
 *
 * Validates: Requirements 23.3
 */
import { describe, it, expect } from "vitest";
import { computeLeadScore, type ScoringRule, type LeadAttributes } from "../src/modules/leads/scoring.js";
import { weightedForecast, type DealForForecast } from "../src/modules/deals/forecast.js";

describe("Lead Scoring — Boundary Conditions", () => {
  describe("zero/empty inputs", () => {
    it("returns 0 for empty rules array", () => {
      const lead: LeadAttributes = { company_size: "large" };
      expect(computeLeadScore(lead, [])).toBe(0);
    });

    it("returns 0 for empty lead attributes with rules expecting them", () => {
      const rules: ScoringRule[] = [
        { attribute: "company_size", weight: 50, scoreFn: (v) => v === "large" ? 100 : 0 },
        { attribute: "engagement", weight: 50, scoreFn: (v) => typeof v === "number" ? v : 0 },
      ];
      // All attributes undefined → scoreFn receives undefined → returns 0
      expect(computeLeadScore({}, rules)).toBe(0);
    });
  });

  describe("all-zero weights", () => {
    it("returns 0 when all rule weights are 0", () => {
      const rules: ScoringRule[] = [
        { attribute: "a", weight: 0, scoreFn: () => 100 },
        { attribute: "b", weight: 0, scoreFn: () => 100 },
      ];
      const lead: LeadAttributes = { a: "x", b: "y" };
      expect(computeLeadScore(lead, rules)).toBe(0);
    });
  });

  describe("max score overflow protection", () => {
    it("clamps to 100 when raw weighted sum exceeds 100", () => {
      // weights sum to 200 (invalid config) but each scoreFn returns 100
      const rules: ScoringRule[] = [
        { attribute: "a", weight: 100, scoreFn: () => 100 },
        { attribute: "b", weight: 100, scoreFn: () => 100 },
      ];
      const lead: LeadAttributes = { a: "x", b: "y" };
      // (100*100 + 100*100) / 100 = 200 → clamped to 100
      expect(computeLeadScore(lead, rules)).toBe(100);
    });

    it("clamps scoreFn output above 100 to 100", () => {
      const rules: ScoringRule[] = [
        { attribute: "a", weight: 100, scoreFn: () => 999 },
      ];
      const lead: LeadAttributes = { a: "x" };
      // scoreFn returns 999, clamped to 100 → (100*100)/100 = 100
      expect(computeLeadScore(lead, rules)).toBe(100);
    });

    it("clamps negative scoreFn output to 0", () => {
      const rules: ScoringRule[] = [
        { attribute: "a", weight: 100, scoreFn: () => -50 },
      ];
      const lead: LeadAttributes = { a: "x" };
      // scoreFn returns -50, clamped to 0 → (100*0)/100 = 0
      expect(computeLeadScore(lead, rules)).toBe(0);
    });
  });

  describe("single rule", () => {
    it("handles a single rule with weight 100 and perfect score", () => {
      const rules: ScoringRule[] = [
        { attribute: "engagement", weight: 100, scoreFn: () => 100 },
      ];
      expect(computeLeadScore({ engagement: "high" }, rules)).toBe(100);
    });

    it("handles a single rule with weight 100 and zero score", () => {
      const rules: ScoringRule[] = [
        { attribute: "engagement", weight: 100, scoreFn: () => 0 },
      ];
      expect(computeLeadScore({ engagement: "none" }, rules)).toBe(0);
    });
  });
});

describe("Forecast Computation — Boundary Conditions", () => {
  describe("empty deals array", () => {
    it("returns 0n for empty deals with empty probability map", () => {
      expect(weightedForecast([], new Map())).toBe(0n);
    });

    it("returns 0n for empty deals even with populated probability map", () => {
      const probs = new Map([["s1", 50], ["s2", 75]]);
      expect(weightedForecast([], probs)).toBe(0n);
    });
  });

  describe("probability = 0", () => {
    it("returns 0n when all stages have 0% probability", () => {
      const deals: DealForForecast[] = [
        { id: "d1", stageId: "s1", valueMinor: 1_000_000_00n },
      ];
      expect(weightedForecast(deals, new Map([["s1", 0]]))).toBe(0n);
    });

    it("returns 0n when stage probability is missing from map", () => {
      const deals: DealForForecast[] = [
        { id: "d1", stageId: "unknown", valueMinor: 500_000n },
      ];
      expect(weightedForecast(deals, new Map())).toBe(0n);
    });
  });

  describe("probability = 100", () => {
    it("returns full value when probability is 100%", () => {
      const deals: DealForForecast[] = [
        { id: "d1", stageId: "s1", valueMinor: 12345678n },
      ];
      expect(weightedForecast(deals, new Map([["s1", 100]]))).toBe(12345678n);
    });
  });

  describe("bigint near MAX_SAFE_INTEGER", () => {
    it("handles deal values exceeding Number.MAX_SAFE_INTEGER", () => {
      const bigValue = 9_007_199_254_740_991n; // 2^53 - 1
      const deals: DealForForecast[] = [
        { id: "d1", stageId: "s1", valueMinor: bigValue },
      ];
      const result = weightedForecast(deals, new Map([["s1", 100]]));
      expect(result).toBe(bigValue);
    });

    it("handles large computation without precision loss", () => {
      const bigValue = 999_999_999_999_999_999n; // close to 10^18
      const deals: DealForForecast[] = [
        { id: "d1", stageId: "s1", valueMinor: bigValue },
      ];
      const result = weightedForecast(deals, new Map([["s1", 50]]));
      // 999999999999999999 * 50 / 100 = 499999999999999999 (floor)
      expect(result).toBe(499_999_999_999_999_999n);
    });
  });

  describe("zero-value deals", () => {
    it("returns 0n for a deal with valueMinor = 0n", () => {
      const deals: DealForForecast[] = [
        { id: "d1", stageId: "s1", valueMinor: 0n },
      ];
      expect(weightedForecast(deals, new Map([["s1", 80]]))).toBe(0n);
    });
  });
});
