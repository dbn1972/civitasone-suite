/**
 * Lead scoring domain logic tests.
 *
 * Tests the pure `computeLeadScore` function covering:
 * - Basic scoring with multiple rules
 * - Weight normalization (weights sum to 100)
 * - Clamping to [0, 100]
 * - Empty rules → 0
 * - Single rule
 * - Missing attributes
 * - scoreFn returning out-of-range values
 *
 * Validates: Requirements 8.5
 */
import { describe, it, expect } from "vitest";
import { computeLeadScore, type ScoringRule, type LeadAttributes } from "../src/modules/leads/scoring.js";

describe("computeLeadScore", () => {
  describe("basic scoring", () => {
    it("computes weighted sum with multiple rules", () => {
      const rules: ScoringRule[] = [
        { attribute: "source", weight: 60, scoreFn: () => 80 },
        { attribute: "engagement", weight: 40, scoreFn: () => 50 },
      ];
      const lead: LeadAttributes = { source: "web", engagement: "medium" };
      // (60 * 80 + 40 * 50) / 100 = (4800 + 2000) / 100 = 68
      expect(computeLeadScore(lead, rules)).toBe(68);
    });

    it("produces 100 when all scoreFns return 100 and weights sum to 100", () => {
      const rules: ScoringRule[] = [
        { attribute: "a", weight: 50, scoreFn: () => 100 },
        { attribute: "b", weight: 50, scoreFn: () => 100 },
      ];
      expect(computeLeadScore({}, rules)).toBe(100);
    });

    it("produces 0 when all scoreFns return 0", () => {
      const rules: ScoringRule[] = [
        { attribute: "a", weight: 50, scoreFn: () => 0 },
        { attribute: "b", weight: 50, scoreFn: () => 0 },
      ];
      expect(computeLeadScore({}, rules)).toBe(0);
    });

    it("passes the correct attribute value to scoreFn", () => {
      const received: unknown[] = [];
      const rules: ScoringRule[] = [
        {
          attribute: "company",
          weight: 100,
          scoreFn: (val) => { received.push(val); return 50; },
        },
      ];
      const lead: LeadAttributes = { company: "Acme Corp" };
      computeLeadScore(lead, rules);
      expect(received).toEqual(["Acme Corp"]);
    });
  });

  describe("weight normalization", () => {
    it("correctly applies uneven weights", () => {
      const rules: ScoringRule[] = [
        { attribute: "a", weight: 70, scoreFn: () => 100 },
        { attribute: "b", weight: 30, scoreFn: () => 0 },
      ];
      // (70 * 100 + 30 * 0) / 100 = 70
      expect(computeLeadScore({}, rules)).toBe(70);
    });

    it("handles weights that sum to exactly 100 with three rules", () => {
      const rules: ScoringRule[] = [
        { attribute: "a", weight: 33, scoreFn: () => 100 },
        { attribute: "b", weight: 33, scoreFn: () => 100 },
        { attribute: "c", weight: 34, scoreFn: () => 100 },
      ];
      // (33*100 + 33*100 + 34*100) / 100 = 100
      expect(computeLeadScore({}, rules)).toBe(100);
    });

    it("handles a rule with weight 0 (contributes nothing)", () => {
      const rules: ScoringRule[] = [
        { attribute: "a", weight: 0, scoreFn: () => 100 },
        { attribute: "b", weight: 100, scoreFn: () => 60 },
      ];
      // (0*100 + 100*60) / 100 = 60
      expect(computeLeadScore({}, rules)).toBe(60);
    });
  });

  describe("clamping to 0-100", () => {
    it("clamps scoreFn output above 100 to 100 before weighting", () => {
      const rules: ScoringRule[] = [
        { attribute: "a", weight: 100, scoreFn: () => 150 }, // should be clamped to 100
      ];
      // (100 * 100) / 100 = 100
      expect(computeLeadScore({}, rules)).toBe(100);
    });

    it("clamps scoreFn output below 0 to 0 before weighting", () => {
      const rules: ScoringRule[] = [
        { attribute: "a", weight: 100, scoreFn: () => -50 }, // should be clamped to 0
      ];
      // (100 * 0) / 100 = 0
      expect(computeLeadScore({}, rules)).toBe(0);
    });

    it("clamps final score to 100 when weights exceed 100 and scoreFns are high", () => {
      // Weights intentionally exceed 100 (misconfigured rules)
      const rules: ScoringRule[] = [
        { attribute: "a", weight: 80, scoreFn: () => 100 },
        { attribute: "b", weight: 80, scoreFn: () => 100 },
      ];
      // (80*100 + 80*100) / 100 = 160, clamped to 100
      expect(computeLeadScore({}, rules)).toBe(100);
    });

    it("result is always an integer", () => {
      const rules: ScoringRule[] = [
        { attribute: "a", weight: 33, scoreFn: () => 33 },
        { attribute: "b", weight: 67, scoreFn: () => 67 },
      ];
      const score = computeLeadScore({}, rules);
      expect(Number.isInteger(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe("empty rules", () => {
    it("returns 0 when rules array is empty", () => {
      expect(computeLeadScore({ anything: "value" }, [])).toBe(0);
    });

    it("returns 0 for empty lead and empty rules", () => {
      expect(computeLeadScore({}, [])).toBe(0);
    });
  });

  describe("single rule", () => {
    it("correctly scores with one rule of weight 100", () => {
      const rules: ScoringRule[] = [
        { attribute: "source", weight: 100, scoreFn: (val) => val === "referral" ? 90 : 30 },
      ];
      expect(computeLeadScore({ source: "referral" }, rules)).toBe(90);
      expect(computeLeadScore({ source: "cold_call" }, rules)).toBe(30);
    });

    it("correctly scores with one rule of weight less than 100", () => {
      const rules: ScoringRule[] = [
        { attribute: "source", weight: 50, scoreFn: () => 80 },
      ];
      // (50 * 80) / 100 = 40
      expect(computeLeadScore({}, rules)).toBe(40);
    });
  });

  describe("missing attributes", () => {
    it("passes undefined to scoreFn when attribute is not on lead", () => {
      let received: unknown = "sentinel";
      const rules: ScoringRule[] = [
        {
          attribute: "nonExistent",
          weight: 100,
          scoreFn: (val) => { received = val; return 50; },
        },
      ];
      computeLeadScore({ other: "value" }, rules);
      expect(received).toBeUndefined();
    });

    it("handles null attribute values gracefully", () => {
      const rules: ScoringRule[] = [
        {
          attribute: "email",
          weight: 100,
          scoreFn: (val) => val ? 80 : 10,
        },
      ];
      expect(computeLeadScore({ email: null }, rules)).toBe(10);
    });
  });
});
