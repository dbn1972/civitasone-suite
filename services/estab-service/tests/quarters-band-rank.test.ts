/**
 * S8-G4 -- quarter-allotment eligibility for a tenant on private grade bands.
 * A band code ("C2") is not a number, so the applicant carries a numeric `rank`; without it the score is
 * computed from the payLevel string exactly as before (a government applicant is unchanged).
 */
import { describe, it, expect } from "vitest";
import { applyAllotmentBody } from "../src/modules/quarters/validators.js";
import { computeEligibilityScore, eligibilityRankOf } from "../src/modules/quarters/domain.js";

describe("eligibilityRankOf", () => {
  it("government: parses the pay level string exactly as the consumer always did", () => {
    expect(eligibilityRankOf({ payLevel: "14" })).toBe(14);
    expect(eligibilityRankOf({ payLevel: "7" })).toBe(7);
    expect(eligibilityRankOf({ payLevel: "10A" })).toBe(10);
    expect(eligibilityRankOf({ payLevel: "" })).toBe(0);
    expect(eligibilityRankOf({ payLevel: "abc" })).toBe(0);
    expect(eligibilityRankOf({})).toBe(0);
  });
  it("government scores are unchanged", () => {
    expect(computeEligibilityScore(eligibilityRankOf({ payLevel: "12" }), 60)).toBe(12 * 10 + 60);
  });
  it("band tenant: a band code alone scores 0 (not a number), a rank scores by rank, and rank wins over payLevel", () => {
    expect(eligibilityRankOf({ payLevel: "C2" })).toBe(0);
    expect(eligibilityRankOf({ payLevel: "C2", rank: 20 })).toBe(20);
    expect(eligibilityRankOf({ payLevel: "9", rank: 40 })).toBe(40);
    expect(eligibilityRankOf({ rank: 0 })).toBe(0);
  });
  it("a more senior band outscores a junior one at equal seniority, and seniority breaks a tie", () => {
    const senior = computeEligibilityScore(eligibilityRankOf({ rank: 40 }), 12);
    const junior = computeEligibilityScore(eligibilityRankOf({ rank: 20 }), 12);
    expect(senior).toBeGreaterThan(junior);
    expect(computeEligibilityScore(eligibilityRankOf({ rank: 20 }), 24)).toBeGreaterThan(junior);
  });
});

describe("applyAllotmentBody", () => {
  const base = { quarterId: "11111111-1111-4111-8111-111111111111", employeeRef: "22222222-2222-4222-8222-222222222222" };
  it("accepts the existing body unchanged (no rank key appears)", () => {
    const b = applyAllotmentBody.parse({ ...base, payLevel: "14", seniorityMonths: 60 });
    expect(b).toEqual({ ...base, payLevel: "14", seniorityMonths: 60 });
    expect(b).not.toHaveProperty("rank");
  });
  it("accepts a band code with a rank, and rejects a non-integer, negative, oversized or string rank", () => {
    expect(applyAllotmentBody.parse({ ...base, payLevel: "C2", rank: 20 })).toMatchObject({ payLevel: "C2", rank: 20 });
    for (const rank of [-1, 1.5, 10000, "20"]) expect(applyAllotmentBody.safeParse({ ...base, rank }).success, String(rank)).toBe(false);
  });
});
