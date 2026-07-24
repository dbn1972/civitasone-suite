/**
 * Quarters domain tests — pure business logic.
 * Validates: state machine, maker-checker, eligibility scoring, overstay calculation.
 */
import { describe, it, expect } from "vitest";
import {
  assertValidTransition, assertMakerChecker, computeEligibilityScore,
  computeOverstayPenalty, findApplicableRate, DomainError,
} from "../src/modules/quarters/domain.js";

describe("Quarters — state machine transitions", () => {
  it("allows applied → waitlisted", () => {
    expect(() => assertValidTransition("applied", "waitlisted")).not.toThrow();
  });
  it("allows waitlisted → allotted", () => {
    expect(() => assertValidTransition("waitlisted", "allotted")).not.toThrow();
  });
  it("allows allotted → occupied", () => {
    expect(() => assertValidTransition("allotted", "occupied")).not.toThrow();
  });
  it("allows occupied → vacation_notice", () => {
    expect(() => assertValidTransition("occupied", "vacation_notice")).not.toThrow();
  });
  it("allows vacation_notice → vacated", () => {
    expect(() => assertValidTransition("vacation_notice", "vacated")).not.toThrow();
  });
  it("allows applied → cancelled", () => {
    expect(() => assertValidTransition("applied", "cancelled")).not.toThrow();
  });
  it("rejects applied → occupied (skip)", () => {
    expect(() => assertValidTransition("applied", "occupied")).toThrow(DomainError);
  });
  it("rejects vacated → occupied (backward)", () => {
    expect(() => assertValidTransition("vacated", "occupied")).toThrow(DomainError);
  });
});

describe("Quarters — maker-checker enforcement", () => {
  it("throws when allotter = applicant", () => {
    const same = "aaaa0000-0000-4000-8000-000000000001";
    expect(() => assertMakerChecker(same, same)).toThrow(DomainError);
    expect(() => assertMakerChecker(same, same)).toThrow("allotment approver cannot be the applicant");
  });
  it("passes when allotter ≠ applicant", () => {
    expect(() => assertMakerChecker(
      "aaaa0000-0000-4000-8000-000000000001",
      "bbbb0000-0000-4000-8000-000000000002",
    )).not.toThrow();
  });
});

describe("Quarters — eligibility score", () => {
  it("computes score based on pay level and seniority with default weights", () => {
    // payLevel=14, seniorityMonths=60 → 14*10 + 60*1 = 200
    expect(computeEligibilityScore(14, 60)).toBe(200);
  });
  it("computes score with custom weights", () => {
    expect(computeEligibilityScore(10, 24, { payLevelWeight: 5, seniorityWeight: 2 })).toBe(10 * 5 + 24 * 2);
  });
  it("handles zero seniority", () => {
    expect(computeEligibilityScore(7, 0)).toBe(70);
  });
});

describe("Quarters — overstay penalty calculation", () => {
  it("returns 0 penalty when vacated before due date", () => {
    const due = new Date("2026-07-30");
    const actual = new Date("2026-07-28");
    const result = computeOverstayPenalty(due, actual, 500n, 2);
    expect(result.penaltyDays).toBe(0);
    expect(result.totalMinor).toBe(0n);
  });
  it("calculates correct penalty for 10 days overstay at 2x multiplier", () => {
    const due = new Date("2026-07-01");
    const actual = new Date("2026-07-11"); // 10 days over
    const dailyRate = 1000n; // 10.00 INR per day
    const result = computeOverstayPenalty(due, actual, dailyRate, 2);
    expect(result.penaltyDays).toBe(10);
    // total = 10 * 1000 * 2 = 20000
    expect(result.totalMinor).toBe(20000n);
  });
  it("uses bigint arithmetic correctly for large amounts", () => {
    const due = new Date("2026-01-01");
    const actual = new Date("2026-04-01"); // 90 days
    const dailyRate = 50000n; // 500.00 INR
    const result = computeOverstayPenalty(due, actual, dailyRate, 1.5);
    expect(result.penaltyDays).toBe(90);
    // total = 90 * 50000 * 1.5 = 6_750_000
    expect(result.totalMinor).toBe(6750000n);
  });
});

describe("Quarters — licence-fee effective-dated lookup", () => {
  const rates = [
    { effectiveFrom: "2024-01-01", effectiveTo: "2024-12-31", monthly: 5000 },
    { effectiveFrom: "2025-01-01", effectiveTo: null, monthly: 6000 },
  ];

  it("finds the rate valid for a given date", () => {
    const found = findApplicableRate(rates, "2024-06-15");
    expect(found?.monthly).toBe(5000);
  });
  it("finds the open-ended rate for future dates", () => {
    const found = findApplicableRate(rates, "2026-03-01");
    expect(found?.monthly).toBe(6000);
  });
  it("returns null for dates before any rate", () => {
    const found = findApplicableRate(rates, "2023-01-01");
    expect(found).toBeNull();
  });
});
