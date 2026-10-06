import { describe, it, expect } from "vitest";
import { isModuleEnabled } from "./moduleVisibility";

/**
 * GAP-RECOMMENDATIONS-HOME-04: the recommendations route/nav gate on the key
 * "recommendation" while a tenant's entitlement flag may be named either
 * "recommendation" or "recommendations". These pin that singular/plural
 * equivalence as a deliberate, additive contract (it can only enable, never
 * hide a module), and confirm it does not spill into unrelated modules.
 */
describe("module visibility — recommendation(s) alias (GAP-RECOMMENDATIONS-HOME-04)", () => {
  it("enables the route when the tenant flag is the plural 'recommendations'", () => {
    expect(isModuleEnabled(["recommendations"], "recommendation")).toBe(true);
  });

  it("enables the route when the tenant flag is the singular 'recommendation'", () => {
    expect(isModuleEnabled(["recommendation"], "recommendations")).toBe(true);
    expect(isModuleEnabled(["recommendation"], "recommendation")).toBe(true);
  });

  it("still hides the route when the tenant has neither flag", () => {
    expect(isModuleEnabled(["finance", "hrms"], "recommendation")).toBe(false);
    expect(isModuleEnabled(["finance", "hrms"], "recommendations")).toBe(false);
  });

  it("the alias does not enable an unrelated module", () => {
    expect(isModuleEnabled(["recommendations"], "finance")).toBe(false);
  });
});
