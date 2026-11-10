/**
 * S8 G1, owner decisions of 10 Nov 2026 (second set), pure parts:
 *  - lop_applicable defaults to true, except fixed reimbursements (and employer costs, and run structures);
 *  - ESI has no opt-out;
 *  - the DIC starting template is valid, warning-free, and solves to the expected breakup.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_STATUTORY_CONFIG } from "../src/modules/payroll/domain.js";
import { defaultLopApplicable, validateComponentSpec, checkTemplate, type ComponentSpec } from "../src/modules/pay-components/model.js";
import { createComponentBody, specFromCreate } from "../src/modules/pay-components/api.js";
import { DIC_CTC_TEMPLATE, DIC_CTC_TEMPLATE_NAME } from "../src/modules/ctc/dic-starting-template.js";
import { expandCtc, type CtcTemplateLine } from "../src/modules/ctc/model.js";

const spec = (o: Partial<ComponentSpec>): ComponentSpec => ({ ...DIC_CTC_TEMPLATE[0]!, ...o });

describe("lop_applicable default (owner decision 2)", () => {
  it("true for template earnings", () => {
    expect(defaultLopApplicable("ctc_template", spec({ calc: "pct_of_ctc" }))).toBe(true);
    expect(defaultLopApplicable("ctc_template", spec({ calc: "balancing" }))).toBe(true);
    expect(defaultLopApplicable("ctc_template", spec({ calc: "fixed", isTaxable: true, fixedMinor: 100000n }))).toBe(true); // a taxable fixed allowance is not a reimbursement
  });
  it("false for a fixed, non-taxable reimbursement (phone, conveyance)", () => {
    expect(defaultLopApplicable("ctc_template", spec({ code: "PHONE", calc: "fixed", isTaxable: false, fixedMinor: 100000n }))).toBe(false);
  });
  it("false for employer costs (not paid to the employee) and for a run structure (the engine does not honour it)", () => {
    expect(defaultLopApplicable("ctc_template", spec({ componentType: "employer_cost", calc: "pct_of_basic" }))).toBe(false);
    expect(defaultLopApplicable("run", spec({ calc: "fixed" }))).toBe(false);
  });
  it("an omitted value stays omitted in the request body (the route applies the default); an explicit value is kept", () => {
    const omitted = createComponentBody.parse({ code: "PHONE", name: "Phone reimbursement", calc: "fixed", fixedMinor: "100000" });
    expect(omitted.lopApplicable).toBeUndefined();
    expect(createComponentBody.parse({ code: "PHONE", name: "Phone reimbursement", calc: "fixed", fixedMinor: "100000", lopApplicable: true }).lopApplicable).toBe(true);
    expect(specFromCreate(omitted).lopApplicable).toBe(false); // the safe floor; the route lifts it per kind
  });
});

describe("DIC starting template (seed/config data, not loaded anywhere)", () => {
  it("has a realistic name and every line passes the G2 rules with no template error or warning", () => {
    expect(DIC_CTC_TEMPLATE_NAME).toMatch(/DIC/);
    for (const c of DIC_CTC_TEMPLATE) expect(validateComponentSpec("ctc_template", c), c.code).toEqual([]);
    const check = checkTemplate(DIC_CTC_TEMPLATE.map((c) => ({ code: c.code, calc: c.calc, pctOfCtcBps: c.pctOfCtcBps, isActive: true, employerCostClass: c.employerCostClass, costPlacement: c.costPlacement })));
    expect(check).toEqual({ errors: [], warnings: [] });
  });
  it("carries the owner's starting values and every earning is loss-of-pay applicable", () => {
    const by = Object.fromEntries(DIC_CTC_TEMPLATE.map((c) => [c.code, c]));
    expect(by.BASIC).toMatchObject({ calc: "pct_of_ctc", pctOfCtcBps: 5000 });
    expect(by.HRA).toMatchObject({ calc: "pct_of_basic", pctOfBasic: 50 });
    expect(by.GRATUITY).toMatchObject({ pctOfBasic: 4.81, employerCostClass: "gratuity_provision" });
    expect(by.SPECIAL!.calc).toBe("balancing");
    for (const c of DIC_CTC_TEMPLATE.filter((x) => x.componentType === "earning")) expect(c.lopApplicable, c.code).toBe(true);
  });
  const lines = DIC_CTC_TEMPLATE.map((c): CtcTemplateLine => ({
    code: c.code, name: c.name, componentType: c.componentType === "employer_cost" ? "employer_cost" : "earning", calc: c.calc, pctOfBasic: c.pctOfBasic,
    pctOfCtcBps: c.pctOfCtcBps, fixedMinor: c.fixedMinor, employerCostClass: c.employerCostClass, costPlacement: c.costPlacement, countsForPfWage: c.countsForPfWage,
    countsForEsiWage: c.countsForEsiWage, countsForGratuity: c.countsForGratuity, lopApplicable: c.lopApplicable, payslipOrder: c.payslipOrder,
  }));
  const terms = (rupees: number) => ({ annualFixedMinor: BigInt(rupees) * 100n, annualVariableTargetMinor: null, epfWagePolicy: "ceiling" as const, gratuityProvisionOn: true, overrides: [] });
  it("solves Rs 9,60,000 and Rs 18,00,000 (hand-computed)", () => {
    // 9.6L: M 80,000 | BASIC 40,000 | HRA 20,000 | gratuity 1,924 | PF 12% x 15,000 = 1,800 | SPECIAL = 80,000 - 60,000 - 3,724 = 16,276
    const a = expandCtc({ lines, terms: terms(960_000), cfg: DEFAULT_STATUTORY_CONFIG });
    expect(a.earnings.map((e) => [e.code, e.amountMinor])).toEqual([["BASIC", 4_000_000n], ["HRA", 2_000_000n], ["SPECIAL", 1_627_600n]]);
    expect(a.warnings).toEqual([]);
    // 18L: M 150,000 | BASIC 75,000 | HRA 37,500 | gratuity 3,608 | PF 1,800 | SPECIAL = 150,000 - 112,500 - 5,408 = 32,092
    const b = expandCtc({ lines, terms: terms(1_800_000), cfg: DEFAULT_STATUTORY_CONFIG });
    expect(b.earnings.find((e) => e.code === "SPECIAL")!.amountMinor).toBe(3_209_200n);
    expect(b.unallocatedMinor).toBe(0n);
  });
});
