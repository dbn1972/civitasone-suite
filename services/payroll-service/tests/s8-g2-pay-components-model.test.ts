/** Section 8 G2: the pay-component contract (pure). */
import { describe, it, expect } from "vitest";
import {
  COMPONENT_CALC_TYPES, EMPLOYER_COST_CLASSES, PAY_COMPONENTS_FLAG, checkTemplate, payComponentsEnabled, validateComponentSpec,
  type ComponentSpec,
} from "../src/modules/pay-components/model.js";

const base: ComponentSpec = {
  code: "CONVEYANCE", name: "Conveyance Allowance", componentType: "earning", isTaxable: false, calc: "fixed",
  pctOfBasic: null, pctOfCtcBps: null, fixedMinor: 160000n, employerCostClass: null, costPlacement: "inside_ctc",
  countsForPfWage: false, countsForEsiWage: false, countsForGratuity: false, lopApplicable: false, payslipOrder: null,
};
const codes = (kind: "run" | "ctc_template", c: Partial<ComponentSpec>, isNew = true) => validateComponentSpec(kind, { ...base, ...c }, { isNew }).map((i) => i.code);

describe("flag", () => {
  it("defaults off and only the exact string true turns it on", () => {
    expect(PAY_COMPONENTS_FLAG).toBe("S8_PAY_COMPONENTS_ENABLED");
    expect(payComponentsEnabled({})).toBe(false);
    expect(payComponentsEnabled({ S8_PAY_COMPONENTS_ENABLED: "1" })).toBe(false);
    expect(payComponentsEnabled({ S8_PAY_COMPONENTS_ENABLED: "true" })).toBe(true);
  });
});

describe("contract enums (owner decision 1)", () => {
  it("calc types and employer cost classes are exactly the agreed sets", () => {
    expect([...COMPONENT_CALC_TYPES]).toEqual(["pct_of_ctc", "pct_of_basic", "fixed", "balancing"]);
    expect([...EMPLOYER_COST_CLASSES]).toEqual(["employer_pf", "employer_esi", "gratuity_provision", "group_insurance", "other_employer"]);
  });
});

describe("run structure components: only what the engine honours", () => {
  it("accepts a fixed and a percent-of-basic component", () => {
    expect(codes("run", {})).toEqual([]);
    expect(codes("run", { code: "MEDICAL", name: "Medical Allowance", calc: "pct_of_basic", fixedMinor: null, pctOfBasic: 2.5 })).toEqual([]);
  });
  it("rejects BASIC / DA / HRA (the engine skips them) on create, but allows editing a legacy row of that code", () => {
    for (const code of ["BASIC", "DA", "HRA"]) expect(codes("run", { code })).toContain("CODE_RESERVED");
    expect(codes("run", { code: "HRA", name: "House Rent Allowance" }, false)).toEqual([]);
  });
  it("rejects pct_of_ctc, balancing, employer classes, wage flags and LOP", () => {
    expect(codes("run", { calc: "pct_of_ctc", fixedMinor: null, pctOfCtcBps: 1000 })).toContain("CALC_NOT_ALLOWED");
    expect(codes("run", { calc: "balancing", fixedMinor: null })).toContain("CALC_NOT_ALLOWED");
    expect(codes("run", { employerCostClass: "group_insurance" })).toContain("EMPLOYER_CLASS_NOT_ALLOWED");
    expect(codes("run", { countsForPfWage: true })).toContain("WAGE_FLAGS_NOT_ALLOWED");
    expect(codes("run", { lopApplicable: true })).toContain("LOP_NOT_ALLOWED");
  });
  it("amount must match the calc exactly, percent 0..100 with 2 decimals", () => {
    expect(codes("run", { fixedMinor: null })).toContain("AMOUNT_MISMATCH");
    expect(codes("run", { pctOfBasic: 5 })).toContain("AMOUNT_MISMATCH");
    expect(codes("run", { calc: "pct_of_basic", fixedMinor: null, pctOfBasic: 100.5 })).toContain("PCT_RANGE");
    expect(codes("run", { calc: "pct_of_basic", fixedMinor: null, pctOfBasic: 12.345 })).toContain("PCT_RANGE");
    expect(codes("run", { fixedMinor: -1n })).toContain("FIXED_RANGE");
  });
  it("code charset", () => {
    for (const code of ["a", "lower", "1ABC", "HAS SPACE", "X".repeat(33)]) expect(codes("run", { code })).toContain("CODE_INVALID");
  });
});

describe("ctc_template lines", () => {
  const tpl = (c: Partial<ComponentSpec>) => codes("ctc_template", c);
  it("accepts the four calc types", () => {
    expect(tpl({ code: "BASIC", name: "Basic", calc: "pct_of_ctc", fixedMinor: null, pctOfCtcBps: 5000, countsForPfWage: true, countsForGratuity: true })).toEqual([]);
    expect(tpl({ code: "HRA", name: "House Rent Allowance", calc: "pct_of_basic", fixedMinor: null, pctOfBasic: 50 })).toEqual([]);
    expect(tpl({ code: "SPECIAL", name: "Special Allowance", calc: "balancing", fixedMinor: null })).toEqual([]);
    expect(tpl({})).toEqual([]);
  });
  it("employer PF / ESI carry no calc or amount; the others do", () => {
    const emp = { componentType: "employer_cost" as const, calc: null, fixedMinor: null };
    expect(tpl({ ...emp, code: "ER_PF", name: "Employer PF", employerCostClass: "employer_pf" })).toEqual([]);
    expect(tpl({ ...emp, code: "ER_ESI", name: "Employer ESI", employerCostClass: "employer_esi", costPlacement: "on_top" })).toEqual([]);
    expect(tpl({ ...emp, code: "ER_PF", name: "Employer PF", employerCostClass: "employer_pf", calc: "fixed", fixedMinor: 100n })).toContain("STATUTORY_CLASS_NO_AMOUNT");
    expect(tpl({ componentType: "employer_cost", code: "GRATUITY", name: "Gratuity provision", employerCostClass: "gratuity_provision", calc: "pct_of_basic", fixedMinor: null, pctOfBasic: 4.81 })).toEqual([]);
    expect(tpl({ componentType: "employer_cost", code: "GROUP_INS", name: "Group insurance", employerCostClass: "group_insurance", calc: null, fixedMinor: null })).toContain("CALC_REQUIRED");
  });
  it("class and type must agree; balancing must be an earning; placement needs a class", () => {
    expect(tpl({ componentType: "employer_cost", employerCostClass: null })).toContain("EMPLOYER_CLASS_MISMATCH");
    expect(tpl({ componentType: "earning", employerCostClass: "group_insurance" })).toContain("EMPLOYER_CLASS_MISMATCH");
    expect(tpl({ componentType: "employer_cost", employerCostClass: "group_insurance", calc: "balancing", fixedMinor: null })).toContain("BALANCING_MUST_BE_EARNING");
    expect(tpl({ costPlacement: "on_top" })).toContain("PLACEMENT_NEEDS_CLASS");
    expect(tpl({ componentType: "deduction" })).toContain("TYPE_NOT_ALLOWED");
  });
  it("pct_of_ctc is bounded to 10000 bps", () => {
    expect(tpl({ calc: "pct_of_ctc", fixedMinor: null, pctOfCtcBps: 10001 })).toContain("PCT_RANGE");
  });
});

describe("template check (owner decision 1 validations)", () => {
  const line = (code: string, calc: "pct_of_ctc" | "pct_of_basic" | "fixed" | "balancing", bps: number | null = null, isActive = true) =>
    ({ code, calc, pctOfCtcBps: bps, isActive, employerCostClass: null });
  it("blocks a second balancing line and parts above 100% of CTC", () => {
    expect(checkTemplate([line("BASIC", "pct_of_ctc", 5000), line("SA", "balancing"), line("OTH", "balancing")]).errors.map((e) => e.code)).toEqual(["MULTIPLE_BALANCING"]);
    expect(checkTemplate([line("BASIC", "pct_of_ctc", 6000), line("OTH", "pct_of_ctc", 4500)]).errors.map((e) => e.code)).toContain("PCT_OF_CTC_OVER_100");
  });
  it("warns when basic is under 50% of CTC, when there is no basic, and when nothing balances", () => {
    const w = (l: ReturnType<typeof line>[]) => checkTemplate(l).warnings.map((x) => x.code);
    expect(w([line("BASIC", "pct_of_ctc", 4000), line("SA", "balancing")])).toEqual(["BASIC_BELOW_50_PCT"]);
    expect(w([line("BASIC", "pct_of_ctc", 5000), line("SA", "balancing")])).toEqual([]);
    expect(w([line("SA", "balancing")])).toEqual(["NO_BASIC"]);
    expect(w([line("BASIC", "pct_of_ctc", 5000)])).toEqual(["NO_BALANCING"]);
  });
  it("ignores inactive lines", () => {
    expect(checkTemplate([line("BASIC", "pct_of_ctc", 5000), line("SA", "balancing"), line("OLD", "balancing", null, false)]).errors).toEqual([]);
  });
});
