import { describe, it, expect } from "vitest";
import { getHelpModule } from "./helpContent";
import { explain } from "./glossary";

// GAP-BILLING-HOME-05: the billing hub now passes help="billing" (previously no
// help slug). This fails on the old tree where no 'billing' HelpModule existed,
// so /help/billing would notFound(). Every term must resolve so the page renders.
describe("billing help module (GAP-BILLING-HOME-05)", () => {
  it("resolves getHelpModule('billing') with summary, tasks and terms", () => {
    const mod = getHelpModule("billing");
    expect(mod, "missing billing help guide").toBeDefined();
    expect(mod!.href).toBe("/billing");
    expect(mod!.summary.trim().length).toBeGreaterThan(10);
    expect(mod!.tasks.length).toBeGreaterThan(0);
    for (const t of mod!.tasks) expect(t.steps.length).toBeGreaterThan(0);
  });

  it("every billing term resolves in the glossary (GST/IRN e-invoice wording)", () => {
    const mod = getHelpModule("billing")!;
    for (const term of mod.terms) {
      expect(explain(term), `unresolved term "${term}"`).toBeTruthy();
    }
    expect(mod.terms).toEqual(expect.arrayContaining(["GSTIN", "IRN", "e-invoice", "GSTN"]));
  });
});
