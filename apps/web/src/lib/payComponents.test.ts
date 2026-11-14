import { describe, it, expect } from "vitest";
import { defaultLopApplicable, withLopDefault, emptyForm, formFromRow, parseComponentForm, type ComponentForm, type ComponentRow } from "./payComponents";

const f = (over: Partial<ComponentForm>): ComponentForm => ({ ...emptyForm("run"), code: "CONVEYANCE", name: "Conveyance Allowance", ...over });

describe("parseComponentForm: run structure", () => {
  it("builds a fixed component in paise", () => {
    const r = parseComponentForm("run", f({ calc: "fixed", fixedRupees: "1600.50" }), true);
    expect(r).toMatchObject({ ok: true, payload: { code: "CONVEYANCE", calc: "fixed", fixedMinor: "160050", pctOfBasic: null, pctOfCtcBps: null, employerCostClass: null } });
  });
  it("percent of basic keeps two decimals", () => {
    const r = parseComponentForm("run", f({ calc: "pct_of_basic", pctOfBasic: "12.5" }), true);
    expect(r).toMatchObject({ ok: true, payload: { pctOfBasic: 12.5, fixedMinor: null } });
  });
  it("rejects reserved codes, bad codes, percent over 100 and run-incompatible calc types", () => {
    expect(parseComponentForm("run", f({ code: "HRA", calc: "fixed", fixedRupees: "1" }), true)).toMatchObject({ ok: false, errors: { code: "errCodeReserved" } });
    expect(parseComponentForm("run", f({ code: "lower", calc: "fixed", fixedRupees: "1" }), true)).toMatchObject({ ok: false, errors: { code: "errCode" } });
    expect(parseComponentForm("run", f({ calc: "pct_of_basic", pctOfBasic: "100.5" }), true)).toMatchObject({ ok: false, errors: { amount: "errPctBasic" } });
    expect(parseComponentForm("run", f({ calc: "pct_of_ctc", pctOfCtc: "10" }), true)).toMatchObject({ ok: false, errors: { calc: "errCalcRun" } });
    expect(parseComponentForm("run", f({ calc: "fixed", fixedRupees: "-5" }), true)).toMatchObject({ ok: false, errors: { amount: "errFixed" } });
  });
  it("never sends wage or LOP flags for a run structure", () => {
    const r = parseComponentForm("run", f({ calc: "fixed", fixedRupees: "10", countsForPfWage: true, lopApplicable: true }), true);
    expect(r).toMatchObject({ ok: true, payload: { countsForPfWage: false, lopApplicable: false } });
  });
  it("an edit does not re-judge the code and does not send it", () => {
    const r = parseComponentForm("run", f({ code: "HRA", calc: "fixed", fixedRupees: "10" }), false);
    expect(r.ok && "code" in r.payload).toBe(false);
  });
});

describe("parseComponentForm: CTC template", () => {
  const tpl = (over: Partial<ComponentForm>) => parseComponentForm("ctc_template", { ...emptyForm("ctc_template"), code: "BASIC", name: "Basic Pay", ...over }, true);
  it("percent of CTC is stored in basis points, flags pass through", () => {
    expect(tpl({ calc: "pct_of_ctc", pctOfCtc: "50", countsForPfWage: true, countsForGratuity: true })).toMatchObject({
      ok: true, payload: { calc: "pct_of_ctc", pctOfCtcBps: 5000, countsForPfWage: true, countsForGratuity: true },
    });
  });
  it("balancing has no amount", () => {
    expect(tpl({ code: "SPECIAL", calc: "balancing" })).toMatchObject({ ok: true, payload: { calc: "balancing", pctOfCtcBps: null, pctOfBasic: null, fixedMinor: null } });
  });
  it("employer PF / ESI carry no calc; other employer costs need one and a class", () => {
    expect(tpl({ code: "ER_PF", componentType: "employer_cost", employerCostClass: "employer_pf", calc: "fixed" })).toMatchObject({
      ok: true, payload: { calc: null, employerCostClass: "employer_pf", fixedMinor: null },
    });
    expect(tpl({ code: "GRATUITY", componentType: "employer_cost", employerCostClass: "gratuity_provision", calc: "pct_of_basic", pctOfBasic: "4.81" })).toMatchObject({
      ok: true, payload: { employerCostClass: "gratuity_provision", pctOfBasic: 4.81 },
    });
    expect(tpl({ code: "INS", componentType: "employer_cost", employerCostClass: "", calc: "fixed", fixedRupees: "600" })).toMatchObject({ ok: false, errors: { employerCostClass: "errEmployerClass" } });
  });
  it("placement applies to employer costs only", () => {
    expect(tpl({ calc: "pct_of_ctc", pctOfCtc: "50", costPlacement: "on_top" })).toMatchObject({ ok: true, payload: { costPlacement: "inside_ctc" } });
    expect(tpl({ code: "INS", componentType: "employer_cost", employerCostClass: "group_insurance", calc: "fixed", fixedRupees: "600", costPlacement: "on_top" }))
      .toMatchObject({ ok: true, payload: { costPlacement: "on_top" } });
  });
});

describe("formFromRow", () => {
  const row: ComponentRow = {
    id: "c1", code: "TA", name: "Transport Allowance", componentType: "earning", isTaxable: false, isActive: true, calc: null,
    pctOfBasic: null, pctOfCtcBps: null, fixedMinor: "200000", employerCostClass: null, costPlacement: "inside_ctc",
    countsForPfWage: false, countsForEsiWage: false, countsForGratuity: false, lopApplicable: false, payslipOrder: 10, version: 1,
  };
  it("shows a legacy fixed row (calc null) as fixed rupees", () => {
    expect(formFromRow(row)).toMatchObject({ calc: "fixed", fixedRupees: "2000" });
    expect(formFromRow({ ...row, fixedMinor: "160050" }).fixedRupees).toBe("1600.50");
    expect(formFromRow({ ...row, fixedMinor: null, pctOfBasic: 12.5 })).toMatchObject({ calc: "pct_of_basic", pctOfBasic: "12.5" });
  });
});

describe("loss-of-pay default (owner decision 2; the same rule as the server defaultLopApplicable)", () => {
  const b = { componentType: "earning" as const, calc: "pct_of_ctc" as const, isTaxable: false };
  it("template earnings: yes; fixed non-taxable reimbursement: no; fixed taxable allowance: yes", () => {
    expect(defaultLopApplicable("ctc_template", b)).toBe(true);
    expect(defaultLopApplicable("ctc_template", { ...b, calc: "balancing" })).toBe(true);
    expect(defaultLopApplicable("ctc_template", { ...b, calc: "fixed" })).toBe(false);
    expect(defaultLopApplicable("ctc_template", { ...b, calc: "fixed", isTaxable: true })).toBe(true);
  });
  it("employer costs and run structures: no", () => {
    expect(defaultLopApplicable("ctc_template", { ...b, componentType: "employer_cost" })).toBe(false);
    expect(defaultLopApplicable("run", b)).toBe(false);
  });
  it("emptyForm pre-ticks for a template and not for a run; a touched box or a stored row is never overwritten", () => {
    expect(emptyForm("ctc_template").lopApplicable).toBe(true);
    expect(emptyForm("run").lopApplicable).toBe(false);
    const touched = { ...emptyForm("ctc_template"), lopApplicable: false, lopTouched: true, calc: "pct_of_ctc" as const };
    expect(withLopDefault("ctc_template", touched).lopApplicable).toBe(false);
    const stored = formFromRow({ ...({} as ComponentRow), code: "X", name: "X", componentType: "earning", calc: "pct_of_ctc", pctOfBasic: null, pctOfCtcBps: 100, fixedMinor: null,
      employerCostClass: null, costPlacement: "inside_ctc", isTaxable: false, countsForPfWage: false, countsForEsiWage: false, countsForGratuity: false, lopApplicable: false } as ComponentRow);
    expect(stored.lopTouched).toBe(true);
    expect(withLopDefault("ctc_template", stored).lopApplicable).toBe(false);
  });
});
