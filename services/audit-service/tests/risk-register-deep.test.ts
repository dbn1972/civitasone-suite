/**
 * Audit Service — Risk Register Domain: Deep tests.
 * Source: modules/risk-register/domain.ts
 */
import { describe, it, expect } from "vitest";
import { computeResidualScore, strongestEffectiveness, assertDifferentActor, computeNextReviewDate, isReviewDue, DomainError, type Effectiveness, type ReviewCadence } from "../src/modules/risk-register/domain.js";

describe("computeResidualScore — control effectiveness reduction", () => {
  it("not_tested: no reduction (residual = inherent)", () => {
    expect(computeResidualScore("likely", "catastrophic", "not_tested")).toBe(20); // 4*5=20, 0% reduction
  });
  it("ineffective: no reduction", () => {
    expect(computeResidualScore("possible", "major", "ineffective")).toBe(12); // 3*4=12
  });
  it("partial: 40% reduction", () => {
    expect(computeResidualScore("likely", "catastrophic", "partial")).toBe(12); // 20*(1-0.4)=12
  });
  it("effective: 70% reduction", () => {
    expect(computeResidualScore("likely", "catastrophic", "effective")).toBe(6); // 20*(1-0.7)=6
  });
  it("minimum residual is 1 (never zero)", () => {
    expect(computeResidualScore("rare", "negligible", "effective")).toBe(1); // 1*0.3=0.3 → max(1, round(0.3))=1
  });
  it("throws INVALID_EFFECTIVENESS for unknown", () => {
    expect(() => computeResidualScore("possible", "major", "excellent" as any)).toThrow("INVALID_EFFECTIVENESS");
  });
});

describe("strongestEffectiveness — best control among many", () => {
  it("empty list → not_tested (default)", () => expect(strongestEffectiveness([])).toBe("not_tested"));
  it("single effective → effective", () => expect(strongestEffectiveness(["effective"])).toBe("effective"));
  it("mixed → returns the strongest", () => {
    expect(strongestEffectiveness(["not_tested", "partial", "ineffective"])).toBe("partial");
    expect(strongestEffectiveness(["partial", "effective", "not_tested"])).toBe("effective");
  });
  it("all not_tested → not_tested", () => expect(strongestEffectiveness(["not_tested", "not_tested"])).toBe("not_tested"));
});

describe("assertDifferentActor — maker-checker", () => {
  it("passes when different", () => expect(() => assertDifferentActor("A", "B")).not.toThrow());
  it("throws MAKER_CHECKER_VIOLATION on same actor", () => expect(() => assertDifferentActor("A", "A")).toThrow(DomainError));
  it("throws CHECKER_REQUIRED when checker is empty", () => expect(() => assertDifferentActor("A", "")).toThrow("CHECKER_REQUIRED"));
});

describe("computeNextReviewDate — periodic cycle", () => {
  const from = new Date("2026-01-01T00:00:00Z");
  it("monthly = +30 days", () => expect(computeNextReviewDate(from, "monthly").toISOString().slice(0, 10)).toBe("2026-01-31"));
  it("quarterly = +91 days", () => expect(computeNextReviewDate(from, "quarterly").toISOString().slice(0, 10)).toBe("2026-04-02"));
  it("half_yearly = +182 days", () => expect(computeNextReviewDate(from, "half_yearly").toISOString().slice(0, 10)).toBe("2026-07-02"));
  it("annual = +365 days", () => expect(computeNextReviewDate(from, "annual").toISOString().slice(0, 10)).toBe("2027-01-01"));
  it("throws INVALID_CADENCE for unknown", () => expect(() => computeNextReviewDate(from, "biweekly" as any)).toThrow("INVALID_CADENCE"));
});

describe("isReviewDue", () => {
  it("true when now >= nextReviewDate", () => expect(isReviewDue(new Date("2026-01-01"), new Date("2026-01-02"))).toBe(true));
  it("true at exact date", () => expect(isReviewDue(new Date("2026-01-01"), new Date("2026-01-01"))).toBe(true));
  it("false when before", () => expect(isReviewDue(new Date("2026-07-01"), new Date("2026-01-01"))).toBe(false));
});
