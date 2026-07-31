/**
 * Domain logic unit tests — pure functions, no DB/IO dependency.
 * Covers lifecycle state machine, rate resolution, eligibility evaluation, bundle validation.
 */
import { describe, it, expect } from "vitest";
import { validateTransition, isValidTransition, isSellable, isEditable } from "../src/modules/products/domain.js";
import { resolveEffectiveRate, detectOverlaps, type RateEntry } from "../src/modules/rates/domain.js";
import { evaluateRule, evaluateProductEligibility, type EligibilityRule } from "../src/modules/eligibility/domain.js";
import { validateBundleComponents } from "../src/modules/bundles/domain.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Product Lifecycle
// ═══════════════════════════════════════════════════════════════════════════════
describe("Product lifecycle state machine", () => {
  it("draft → active is valid", () => {
    expect(isValidTransition("draft", "active")).toBe(true);
  });
  it("active → suspended is valid", () => {
    expect(isValidTransition("active", "suspended")).toBe(true);
  });
  it("active → withdrawn is valid", () => {
    expect(isValidTransition("active", "withdrawn")).toBe(true);
  });
  it("suspended → active is valid (reactivation)", () => {
    expect(isValidTransition("suspended", "active")).toBe(true);
  });
  it("withdrawn → closed_to_new_business is valid", () => {
    expect(isValidTransition("withdrawn", "closed_to_new_business")).toBe(true);
  });
  it("draft → withdrawn is invalid", () => {
    expect(isValidTransition("draft", "withdrawn")).toBe(false);
  });
  it("closed_to_new_business → active is invalid", () => {
    expect(isValidTransition("closed_to_new_business", "active")).toBe(false);
  });
  it("validateTransition returns reason on failure", () => {
    const result = validateTransition("draft", "suspended");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Cannot transition");
  });
  it("validateTransition succeeds for same status", () => {
    expect(validateTransition("active", "active").valid).toBe(true);
  });
  it("isSellable only for active", () => {
    expect(isSellable("active")).toBe(true);
    expect(isSellable("draft")).toBe(false);
    expect(isSellable("withdrawn")).toBe(false);
  });
  it("isEditable for draft, active, suspended only", () => {
    expect(isEditable("draft")).toBe(true);
    expect(isEditable("active")).toBe(true);
    expect(isEditable("suspended")).toBe(true);
    expect(isEditable("withdrawn")).toBe(false);
    expect(isEditable("closed_to_new_business")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Rate Resolution
// ═══════════════════════════════════════════════════════════════════════════════
describe("Rate effective-date resolution", () => {
  const rates: RateEntry[] = [
    { id: "r1", effectiveFrom: "2024-01-01", effectiveTo: "2024-06-30", rateValueMinor: 500n, source: "A", version: 1 },
    { id: "r2", effectiveFrom: "2024-07-01", effectiveTo: null, rateValueMinor: 750n, source: "B", version: 1 },
  ];

  it("finds rate for date within first period", () => {
    const result = resolveEffectiveRate(rates, "2024-03-15");
    expect(result?.id).toBe("r1");
  });

  it("finds rate for date within second (open-ended) period", () => {
    const result = resolveEffectiveRate(rates, "2024-12-01");
    expect(result?.id).toBe("r2");
  });

  it("returns null for date before all rates", () => {
    const result = resolveEffectiveRate(rates, "2023-01-01");
    expect(result).toBeNull();
  });

  it("handles exact boundary dates", () => {
    expect(resolveEffectiveRate(rates, "2024-01-01")?.id).toBe("r1");
    expect(resolveEffectiveRate(rates, "2024-06-30")?.id).toBe("r1");
    expect(resolveEffectiveRate(rates, "2024-07-01")?.id).toBe("r2");
  });
});

describe("Rate overlap detection", () => {
  const existing: RateEntry[] = [
    { id: "r1", effectiveFrom: "2024-01-01", effectiveTo: "2024-06-30", rateValueMinor: 500n, source: "A", version: 1 },
  ];

  it("detects overlap with existing period", () => {
    const conflicts = detectOverlaps(existing, "2024-03-01", "2024-09-01");
    expect(conflicts).toContain("r1");
  });

  it("no overlap after existing period", () => {
    const conflicts = detectOverlaps(existing, "2024-07-01", "2024-12-31");
    expect(conflicts).toHaveLength(0);
  });

  it("no overlap before existing period", () => {
    const conflicts = detectOverlaps(existing, "2023-01-01", "2023-12-31");
    expect(conflicts).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Eligibility Rule Evaluation
// ═══════════════════════════════════════════════════════════════════════════════
describe("Eligibility rule evaluation", () => {
  it("age_range — passes when age is within range", () => {
    const rule: EligibilityRule = { id: "1", productId: "p1", ruleType: "age_range", criteria: { minAge: 18, maxAge: 65 } };
    expect(evaluateRule(rule, { age: 30 }).pass).toBe(true);
  });

  it("age_range — fails when age is below minimum", () => {
    const rule: EligibilityRule = { id: "1", productId: "p1", ruleType: "age_range", criteria: { minAge: 18, maxAge: 65 } };
    expect(evaluateRule(rule, { age: 16 }).pass).toBe(false);
  });

  it("age_range — fails when age is above maximum", () => {
    const rule: EligibilityRule = { id: "1", productId: "p1", ruleType: "age_range", criteria: { minAge: 18, maxAge: 65 } };
    expect(evaluateRule(rule, { age: 70 }).pass).toBe(false);
  });

  it("residency — passes for allowed region", () => {
    const rule: EligibilityRule = { id: "2", productId: "p1", ruleType: "residency", criteria: { allowedRegions: ["north", "south"] } };
    expect(evaluateRule(rule, { region: "north" }).pass).toBe(true);
  });

  it("residency — fails for disallowed region", () => {
    const rule: EligibilityRule = { id: "2", productId: "p1", ruleType: "residency", criteria: { allowedRegions: ["north"] } };
    expect(evaluateRule(rule, { region: "west" }).pass).toBe(false);
  });

  it("segment — passes for allowed segment", () => {
    const rule: EligibilityRule = { id: "3", productId: "p1", ruleType: "segment", criteria: { allowedSegments: ["retail", "premium"] } };
    expect(evaluateRule(rule, { segment: "premium" }).pass).toBe(true);
  });

  it("min_income — passes when income sufficient", () => {
    const rule: EligibilityRule = { id: "4", productId: "p1", ruleType: "min_income", criteria: { minIncomeMinor: 50000 } };
    expect(evaluateRule(rule, { incomeMinor: 100000 }).pass).toBe(true);
  });

  it("min_income — fails when income insufficient", () => {
    const rule: EligibilityRule = { id: "4", productId: "p1", ruleType: "min_income", criteria: { minIncomeMinor: 50000 } };
    expect(evaluateRule(rule, { incomeMinor: 30000 }).pass).toBe(false);
  });

  it("unknown rule type fails", () => {
    const rule: EligibilityRule = { id: "5", productId: "p1", ruleType: "unknown_type", criteria: {} };
    expect(evaluateRule(rule, {}).pass).toBe(false);
  });

  it("evaluateProductEligibility — all rules must pass", () => {
    const rules: EligibilityRule[] = [
      { id: "1", productId: "p1", ruleType: "age_range", criteria: { minAge: 18, maxAge: 65 } },
      { id: "2", productId: "p1", ruleType: "residency", criteria: { allowedRegions: ["north"] } },
    ];
    const result = evaluateProductEligibility(rules, { age: 30, region: "north" });
    expect(result.eligible).toBe(true);
  });

  it("evaluateProductEligibility — fails if any rule fails", () => {
    const rules: EligibilityRule[] = [
      { id: "1", productId: "p1", ruleType: "age_range", criteria: { minAge: 18, maxAge: 65 } },
      { id: "2", productId: "p1", ruleType: "residency", criteria: { allowedRegions: ["north"] } },
    ];
    const result = evaluateProductEligibility(rules, { age: 30, region: "west" });
    expect(result.eligible).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Bundle Validation
// ═══════════════════════════════════════════════════════════════════════════════
describe("Bundle component validation", () => {
  it("valid when all components are active", () => {
    const result = validateBundleComponents(
      ["p1", "p2"],
      [{ id: "p1", lifecycleStatus: "active" }, { id: "p2", lifecycleStatus: "active" }],
    );
    expect(result.valid).toBe(true);
  });

  it("invalid when a component is draft", () => {
    const result = validateBundleComponents(
      ["p1", "p2"],
      [{ id: "p1", lifecycleStatus: "active" }, { id: "p2", lifecycleStatus: "draft" }],
    );
    expect(result.valid).toBe(false);
    expect(result.invalidProducts).toHaveLength(1);
    expect(result.invalidProducts[0]!.id).toBe("p2");
  });

  it("invalid when a component is not found", () => {
    const result = validateBundleComponents(
      ["p1", "p2"],
      [{ id: "p1", lifecycleStatus: "active" }],
    );
    expect(result.valid).toBe(false);
    expect(result.invalidProducts[0]!.status).toBe("not_found");
  });
});
