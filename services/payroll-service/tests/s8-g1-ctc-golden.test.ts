/**
 * S8 G1: CTC solver golden cases (hand-computed, paise) and invariants. Pure: no database.
 *
 * Fixture template ("DIC-style starting values", owner decision 1, 10 Nov 2026; DIC finance to confirm, all VERIFY):
 *   BASIC 50% of CTC | HRA 50% of basic (Delhi, metro) | employer PF inside CTC | employer ESI inside CTC (where it applies)
 *   gratuity provision 4.81% of basic inside CTC | group insurance Rs 500 fixed inside CTC | SPECIAL allowance = balancing.
 * Statutory config = DEFAULT_STATUTORY_CONFIG (PF 12% on a Rs 15,000 ceiling, ESI employer 3.25% under Rs 21,000). VERIFY.
 * The 4.81% is the owner's starting value for a template, not a code constant: it lives in this fixture only.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_STATUTORY_CONFIG } from "../src/modules/payroll/domain.js";
import {
  expandCtc, prorateExpansion, CtcError, type CtcTemplateLine, type CtcTerms, type CtcExpansion,
} from "../src/modules/ctc/model.js";

const rs = (n: number): bigint => BigInt(Math.round(n * 100));
const base = { lopApplicable: true, countsForEsiWage: true, countsForGratuity: false, payslipOrder: null, pctOfBasic: null, pctOfCtcBps: null, fixedMinor: null, employerCostClass: null, costPlacement: "inside_ctc" as const };

function template(o: { insurancePlacement?: "inside_ctc" | "on_top"; withEsiLine?: boolean; withPfLine?: boolean } = {}): CtcTemplateLine[] {
  const lines: CtcTemplateLine[] = [
    { ...base, code: "BASIC", name: "Basic", componentType: "earning", calc: "pct_of_ctc", pctOfCtcBps: 5000, countsForPfWage: true, countsForGratuity: true, payslipOrder: 1 },
    { ...base, code: "HRA", name: "House Rent Allowance", componentType: "earning", calc: "pct_of_basic", pctOfBasic: 50, countsForPfWage: false, payslipOrder: 2 },
    { ...base, code: "SPECIAL", name: "Special Allowance", componentType: "earning", calc: "balancing", countsForPfWage: false, payslipOrder: 3 },
    { ...base, code: "GRATUITY", name: "Gratuity provision", componentType: "employer_cost", calc: "pct_of_basic", pctOfBasic: 4.81, employerCostClass: "gratuity_provision", countsForPfWage: false, lopApplicable: false },
    { ...base, code: "GROUP_INS", name: "Group insurance", componentType: "employer_cost", calc: "fixed", fixedMinor: rs(500), employerCostClass: "group_insurance", costPlacement: o.insurancePlacement ?? "inside_ctc", countsForPfWage: false, lopApplicable: false },
  ];
  if (o.withPfLine !== false) lines.push({ ...base, code: "ER_PF", name: "Employer PF", componentType: "employer_cost", calc: null, employerCostClass: "employer_pf", countsForPfWage: false, lopApplicable: false });
  if (o.withEsiLine !== false) lines.push({ ...base, code: "ER_ESI", name: "Employer ESI", componentType: "employer_cost", calc: null, employerCostClass: "employer_esi", countsForPfWage: false, lopApplicable: false });
  return lines;
}
const terms = (annualRupees: number, o: Partial<CtcTerms> = {}): CtcTerms => ({
  annualFixedMinor: rs(annualRupees), annualVariableTargetMinor: null, epfWagePolicy: "ceiling", esiOptOut: false, gratuityProvisionOn: true, overrides: [], ...o,
});
const run = (annual: number, o: Partial<CtcTerms> = {}, lines = template()) => expandCtc({ lines, terms: terms(annual, o), cfg: DEFAULT_STATUTORY_CONFIG });
const amt = (e: CtcExpansion, code: string): bigint | undefined =>
  [...e.earnings, ...e.employerCosts].find((l) => l.code === code || l.code === `EMPLOYER_${code}`)?.amountMinor;
const reconciles = (e: CtcExpansion) => e.grossMinor + e.insideCtcCostsMinor + e.unallocatedMinor === e.monthlyCtcMinor;

describe("CTC solver: golden cases (hand-computed)", () => {
  it("G1  Rs 9,60,000: capped PF, no ESI (gross far over Rs 21,000)", () => {
    // M 80,000 | BASIC 40,000 | HRA 20,000 | gratuity 4.81% x 40,000 = 1,924 | insurance 500 | PF 12% x 15,000 = 1,800
    // inside = 4,224 | SPECIAL = 80,000 - 40,000 - 20,000 - 4,224 = 15,776 | gross 75,776
    const e = run(960_000);
    expect(e.monthlyCtcMinor).toBe(rs(80_000));
    expect(amt(e, "BASIC")).toBe(rs(40_000));
    expect(amt(e, "HRA")).toBe(rs(20_000));
    expect(amt(e, "SPECIAL")).toBe(rs(15_776));
    expect(amt(e, "GRATUITY")).toBe(rs(1_924));
    expect(amt(e, "GROUP_INS")).toBe(rs(500));
    expect(e.employerPfMinor).toBe(rs(1_800));
    expect(e.employerEsiMinor).toBe(0n);
    expect(e.esiApplies).toBe(false);
    expect(e.grossMinor).toBe(rs(75_776));
    expect(e.insideCtcCostsMinor).toBe(rs(4_224));
    expect(e.unallocatedMinor).toBe(0n);
    expect(e.onTopCostsMinor).toBe(0n);
  });

  it("G1b Rs 9,60,000 with PF on actual basic: the balancing figure falls by the extra employer PF", () => {
    // PF 12% x 40,000 = 4,800 | inside = 1,924 + 500 + 4,800 = 7,224 | SPECIAL = 80,000 - 60,000 - 7,224 = 12,776 | gross 72,776
    const e = run(960_000, { epfWagePolicy: "actual" });
    expect(e.employerPfMinor).toBe(rs(4_800));
    expect(amt(e, "SPECIAL")).toBe(rs(12_776));
    expect(e.grossMinor).toBe(rs(72_776));
    expect(e.unallocatedMinor).toBe(0n);
  });

  it("G2  Rs 18,00,000: capped PF, gratuity rounds half up to the rupee", () => {
    // M 150,000 | BASIC 75,000 | HRA 37,500 | gratuity 4.81% x 75,000 = 3,607.50 -> 3,608 | insurance 500 | PF 1,800
    // inside = 5,908 | SPECIAL = 150,000 - 112,500 - 5,908 = 31,592 | gross 144,092
    const e = run(1_800_000);
    expect(amt(e, "HRA")).toBe(rs(37_500));
    expect(amt(e, "GRATUITY")).toBe(rs(3_608));
    expect(amt(e, "SPECIAL")).toBe(rs(31_592));
    expect(e.grossMinor).toBe(rs(144_092));
    expect(e.insideCtcCostsMinor).toBe(rs(5_908));
    expect(e.unallocatedMinor).toBe(0n);
  });

  it("G3  Rs 2,76,000: ESI applies, employer ESI inside CTC is carved out of the balancing line", () => {
    // M 23,000 | BASIC 11,500 | HRA 5,750 | gratuity 4.81% x 11,500 = 553.15 -> 553 | insurance 500 | PF 12% x 11,500 = 1,380
    // ESI off first: SPECIAL 3,317 -> gross 20,567 <= 21,000 so ESI applies. ESI on: gross G with G + round(3.25% G) <= 20,567
    // G = 19,920 -> ESI 647.40 -> 647 | G + ESI = 20,567 | SPECIAL = 19,920 - 17,250 = 2,670 | total 23,000 exactly
    const e = run(276_000);
    expect(e.esiApplies).toBe(true);
    expect(amt(e, "BASIC")).toBe(rs(11_500));
    expect(amt(e, "GRATUITY")).toBe(rs(553));
    expect(e.employerPfMinor).toBe(rs(1_380));
    expect(e.employerEsiMinor).toBe(rs(647));
    expect(amt(e, "SPECIAL")).toBe(rs(2_670));
    expect(e.grossMinor).toBe(rs(19_920));
    expect(e.unallocatedMinor).toBe(0n);
    expect(e.warnings.map((w) => w.code)).toContain("ESI_CEILING_CLIFF");
  });

  it("G4  Rs 2,88,000: just over the ESI cliff, ESI is off and the gross is HIGHER than at Rs 2,76,000 + its ESI", () => {
    // M 24,000 | BASIC 12,000 | HRA 6,000 | gratuity 4.81% x 12,000 = 577.2 -> 577 | insurance 500 | PF 1,440
    // ESI off: SPECIAL = 24,000 - 18,000 - 2,517 = 3,483 | gross 21,483 > 21,000 -> ESI off
    const e = run(288_000);
    expect(e.esiApplies).toBe(false);
    expect(e.employerEsiMinor).toBe(0n);
    expect(amt(e, "SPECIAL")).toBe(rs(3_483));
    expect(e.grossMinor).toBe(rs(21_483));
    expect(e.unallocatedMinor).toBe(0n);
  });

  it("G5  negotiated HRA of Rs 24,000 on Rs 9,60,000 (per-employee override, no new template): special absorbs it", () => {
    // BASIC 40,000 | HRA 24,000 (override) | inside 4,224 | SPECIAL = 80,000 - 64,000 - 4,224 = 11,776 | gross 75,776 (unchanged)
    const e = run(960_000, { overrides: [{ code: "HRA", monthlyMinor: rs(24_000) }] });
    expect(amt(e, "HRA")).toBe(rs(24_000));
    expect(e.earnings.find((l) => l.code === "HRA")!.source).toBe("override");
    expect(amt(e, "SPECIAL")).toBe(rs(11_776));
    expect(e.grossMinor).toBe(rs(75_776));
  });

  it("G6  gratuity provision switched off for the employee: the freed Rs 1,924 goes to the balancing line", () => {
    // inside = 500 + 1,800 = 2,300 | SPECIAL = 80,000 - 60,000 - 2,300 = 17,700
    const e = run(960_000, { gratuityProvisionOn: false });
    expect(amt(e, "GRATUITY")).toBeUndefined();
    expect(amt(e, "SPECIAL")).toBe(rs(17_700));
    expect(e.gratuityMinor).toBe(0n);
  });

  it("G7  group insurance ON TOP of CTC: not carved out of the balancing line, reported as an on-top cost", () => {
    // inside = 1,924 + 1,800 = 3,724 | SPECIAL = 80,000 - 60,000 - 3,724 = 16,276 | on top = 500
    const e = run(960_000, {}, template({ insurancePlacement: "on_top" }));
    expect(amt(e, "SPECIAL")).toBe(rs(16_276));
    expect(e.onTopCostsMinor).toBe(rs(500));
    expect(e.insideCtcCostsMinor).toBe(rs(3_724));
    expect(reconciles(e)).toBe(true);
  });

  it("G8  template without employer PF / ESI lines: both are real costs ON TOP of CTC, with a warning", () => {
    // no PF inside: inside = 1,924 + 500 = 2,424 | SPECIAL = 80,000 - 60,000 - 2,424 = 17,576 | PF 1,800 on top
    const e = run(960_000, {}, template({ withPfLine: false, withEsiLine: false }));
    expect(amt(e, "SPECIAL")).toBe(rs(17_576));
    expect(e.employerPfMinor).toBe(rs(1_800));
    expect(e.onTopCostsMinor).toBe(rs(1_800));
    expect(e.warnings.map((w) => w.code)).toContain("PF_NOT_IN_TEMPLATE");
  });

  it("G9  engagement without provident fund: no employer PF, nothing carved out", () => {
    const e = expandCtc({ lines: template(), terms: terms(960_000), cfg: DEFAULT_STATUTORY_CONFIG, pfApplicable: false });
    expect(e.employerPfMinor).toBe(0n);
    expect(amt(e, "SPECIAL")).toBe(rs(17_576));
  });

  it("G10 variable target is informational: the monthly breakup does not change", () => {
    const e = run(960_000, { annualVariableTargetMinor: rs(120_000) });
    expect(e.annualVariableTargetMinor).toBe(rs(120_000));
    expect(e.grossMinor).toBe(rs(75_776));
  });
});

describe("CTC solver: refusals", () => {
  it("blocks a negative balancing figure", () => {
    const lines = template();
    lines.find((l) => l.code === "HRA")!.pctOfBasic = 100; // BASIC 50% + HRA 100% of basic = 100% of CTC before employer costs
    expect(() => run(960_000, {}, lines)).toThrowError(/CTC_NEGATIVE_BALANCING/);
  });
  it("needs a BASIC line and a direct BASIC", () => {
    expect(() => run(960_000, {}, template().filter((l) => l.code !== "BASIC"))).toThrowError(/CTC_TEMPLATE_NO_BASIC/);
    const l = template(); l.find((x) => x.code === "BASIC")!.calc = "balancing";
    expect(() => run(960_000, {}, l)).toThrowError(/CTC_BASIC_NOT_DIRECT|MULTIPLE_BALANCING/);
  });
  it("refuses an override of the balancing line, of a statutory line, of an unknown line", () => {
    expect(() => run(960_000, { overrides: [{ code: "SPECIAL", monthlyMinor: rs(1) }] })).toThrowError(/CTC_OVERRIDE_BALANCING/);
    expect(() => run(960_000, { overrides: [{ code: "ER_PF", monthlyMinor: rs(1) }] })).toThrowError(/CTC_OVERRIDE_STATUTORY/);
    expect(() => run(960_000, { overrides: [{ code: "NOPE", monthlyMinor: rs(1) }] })).toThrowError(/CTC_OVERRIDE_UNKNOWN_COMPONENT/);
  });
  it("refuses a non-positive CTC and two lines with one code", () => {
    expect(() => run(0)).toThrowError(CtcError);
    expect(() => run(960_000, {}, [...template(), template()[0]!])).toThrowError(/CTC_TEMPLATE_DUPLICATE_CODE/);
  });
  it("without a balancing line the gap is reported, never hidden", () => {
    const lines = template().filter((l) => l.code !== "SPECIAL");
    const e = run(960_000, {}, lines);
    expect(e.unallocatedMinor).toBe(rs(80_000 - 60_000 - 4_224));
    expect(e.warnings.map((w) => w.code)).toContain("PARTS_DO_NOT_SUM_TO_CTC");
  });
  it("warns when basic is under 50% of CTC", () => {
    const lines = template(); lines.find((l) => l.code === "BASIC")!.pctOfCtcBps = 4000;
    expect(run(960_000, {}, lines).warnings.map((w) => w.code)).toContain("BASIC_BELOW_50_PCT");
  });
});

describe("CTC solver: proration by calendar days (owner decision 3)", () => {
  const cfg = DEFAULT_STATUTORY_CONFIG;
  it("P1  joins on 11 Nov 2026 (10 of 30 days not in service) on Rs 9,60,000: every line x 20/30, PF/gratuity re-priced", () => {
    // BASIC 40,000 x 2/3 = 26,666.67 -> 26,667 | HRA 13,333 | SPECIAL 15,776 x 2/3 = 10,517.33 -> 10,517 | gross 50,517
    // PF wage 26,667 > 15,000 -> PF 1,800 | gratuity 4.81% x 26,667 = 1,282.65 -> 1,283 | insurance 500 x 2/3 = 333.33 -> 333 | ESI off
    const e = run(960_000);
    const paid = prorateExpansion(e, { lopDays: 10, notInServiceDays: 10, daysInMonth: 30n }, cfg);
    expect(paid.basicMinor).toBe(rs(26_667));
    expect(paid.hraMinor).toBe(rs(13_333));
    expect(paid.earnings.find((l) => l.code === "SPECIAL")!.amountMinor).toBe(rs(10_517));
    expect(paid.grossMinor).toBe(rs(50_517));
    expect(paid.pfWageMinor).toBe(rs(26_667));
    expect(paid.employerPfMinor).toBe(rs(1_800));
    expect(paid.gratuityMinor).toBe(rs(1_283));
    expect(paid.employerCosts.find((c) => c.code === "GROUP_INS")!.amountMinor).toBe(rs(333));
    expect(paid.employerEsiMinor).toBe(0n);
  });
  it("P2  3 days of leave LOP reach only lines flagged lop_applicable; the join-date days reach all", () => {
    const lines = template(); lines.find((l) => l.code === "HRA")!.lopApplicable = false;
    const e = run(960_000, {}, lines);
    const paid = prorateExpansion(e, { lopDays: 3, notInServiceDays: 0, daysInMonth: 30n }, cfg);
    expect(paid.hraMinor).toBe(rs(20_000)); // HRA is not LOP-applicable here
    expect(paid.basicMinor).toBe(rs(36_000)); // 40,000 x 27/30
    expect(paid.earnings.find((l) => l.code === "SPECIAL")!.amountMinor).toBe(rs(14_198)); // 15,776 x 0.9 = 14,198.40
  });
  it("P3  no unpaid days: the paid month equals the full month", () => {
    const e = run(960_000);
    const paid = prorateExpansion(e, { lopDays: 0, notInServiceDays: 0, daysInMonth: 30n }, cfg);
    expect(paid.grossMinor).toBe(e.grossMinor);
    expect(paid.employerPfMinor).toBe(e.employerPfMinor);
    expect(paid.gratuityMinor).toBe(e.gratuityMinor);
  });
  it("P4  a part-month joiner whose prorated gross falls under the ESI ceiling picks up ESI on that gross (VERIFY)", () => {
    const e = run(960_000);
    const paid = prorateExpansion(e, { lopDays: 24, notInServiceDays: 24, daysInMonth: 30n }, cfg); // 6 of 30 days: gross 75,776 x 0.2 = 15,155
    expect(paid.grossMinor).toBe(rs(15_155));
    expect(paid.employerEsiMinor).toBe(rs(493)); // 3.25% x 15,155 = 492.5 -> 493
    expect(paid.employerCosts.some((c) => c.employerCostClass === "employer_esi" && c.costPlacement === "on_top")).toBe(true);
  });
});

describe("CTC solver: invariants over 1,000 pseudo-random CTCs", () => {
  let seed = 20261110;
  const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
  it("parts + inside-CTC employer costs + rounding residue = monthly CTC; balancing never negative; residue under Rs 2", () => {
    for (let i = 0; i < 1000; i++) {
      const annual = 200_000 + (next() % 4_800_000); // Rs 2 lakh .. Rs 50 lakh
      const policy = next() % 2 === 0 ? "ceiling" as const : "actual" as const;
      const e = run(annual, { epfWagePolicy: policy, gratuityProvisionOn: next() % 5 !== 0 });
      expect(reconciles(e), `CTC ${annual} ${policy}`).toBe(true);
      expect(e.unallocatedMinor >= 0n && e.unallocatedMinor < rs(2), `CTC ${annual}: residue ${e.unallocatedMinor}`).toBe(true);
      expect(e.earnings.find((l) => l.code === "SPECIAL")!.amountMinor >= 0n).toBe(true);
      for (const l of [...e.earnings, ...e.employerCosts]) expect(l.amountMinor % 100n).toBe(0n);
      // ESI state is exactly the engine rule on the booked gross
      expect(e.esiApplies).toBe(e.grossMinor <= DEFAULT_STATUTORY_CONFIG.esiWageCapMinor);
    }
  });
});
