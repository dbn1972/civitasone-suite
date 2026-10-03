import { describe, it, expect } from "vitest";
import { estimateGratuity, DEFAULT_GRATUITY_RULE, isGratuityRuleView, type GratuityRuleView } from "./gratuityEstimate";

const dcrg: GratuityRuleView = { ruleSet: "ccs_dcrg", minServiceYears: 5, ceilingMinor: "250000000", source: "tenant" };

describe("estimateGratuity (GAP-PAYROLL-STATUTORY-GRATUITY-01)", () => {
  it("default rule keeps the Payment of Gratuity Act result (15/26 x years, Rs 20 lakh cap)", () => {
    const e = estimateGratuity(DEFAULT_GRATUITY_RULE, 10, 5_000_000n);
    expect(e.minor).toBe(28_846_153n);
    const capped = estimateGratuity(DEFAULT_GRATUITY_RULE, 30, 50_000_000n);
    expect(capped.capped).toBe(true);
    expect(capped.minor).toBe(200_000_000n);
  });

  it("Govt Department, 22 years: DCRG 1/4 x emoluments x 44 half-years, not 15/26 x 22", () => {
    const e = estimateGratuity(dcrg, 22, 15_000_000n);
    expect(e.units).toBe(44);
    expect(e.minor).toBe(165_000_000n);
    expect(e.minor).not.toBe(estimateGratuity(DEFAULT_GRATUITY_RULE, 22, 15_000_000n).minor);
  });

  it("DCRG counts completed half-years only and honours the 16.5x and ceiling caps", () => {
    expect(estimateGratuity(dcrg, 10.58, 1_000_000n).units).toBe(21);
    expect(estimateGratuity(dcrg, 10.49, 1_000_000n).units).toBe(20);
    expect(estimateGratuity(dcrg, 50, 1_000_000n).minor).toBe(16_500_000n);
    const e = estimateGratuity(dcrg, 33, 75_000_000n);
    expect(e.capped).toBe(true);
    expect(e.minor).toBe(250_000_000n);
  });

  it("validates a rule payload before trusting it", () => {
    expect(isGratuityRuleView(dcrg)).toBe(true);
    expect(isGratuityRuleView({ ruleSet: "x", minServiceYears: 5, ceilingMinor: "1" })).toBe(false);
    expect(isGratuityRuleView({ ruleSet: "pog_act", minServiceYears: 5, ceilingMinor: "-1" })).toBe(false);
    expect(isGratuityRuleView(null)).toBe(false);
  });
});
