/**
 * L10 -- Domain Correctness: payroll statutory corrections (T-STAT, PR #2449)
 * mutation burn-down for services/payroll-service/src/modules/payroll/domain.ts.
 *
 * PR #2449 added the s.192 projection (salary paid + unrecorded months +
 * this month less LOP + regular x remaining + one-offs once), the NPS base on
 * arrears, the PT-on-gross resolver, the arrears review / zero-basic approval
 * helpers and the pensioner estimate. Those lines were exercised only by
 * real-DB suites outside the Stryker scope, so their mutants read as
 * Survived / NoCoverage. Every expected value below is computed BY HAND from
 * the statute and the documented constants (shown in the comments), never read
 * back from the implementation:
 *   roundRupee(x) = floor((x + 50) / 100) * 100 (paise, half-up)
 *   new regime FY 2026-27: 0-4L nil, 4-8L 5%, 8-12L 10%, 12-16L 15%, 16-20L 20%,
 *   20-24L 25%, >24L 30%; std deduction 75,000; 4% cess; s.288B nearest Rs 10.
 *   old regime: 0-2.5L nil, 2.5-5L 5%, 5-10L 20%, >10L 30%; std deduction 50,000.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");
const R = (rupees: number): bigint => BigInt(Math.round(rupees * 100));
const FY = 2026;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let d: any;

beforeAll(async () => {
  d = await import(`${REPO_ROOT}/services/payroll-service/src/modules/payroll/domain.js`);
  const { registerTaxConfig } = await import(`${REPO_ROOT}/services/payroll-service/src/modules/tax/engine.js`);
  const surcharge = [{ above: 5000000, rate: 0.10 }, { above: 10000000, rate: 0.15 }, { above: 20000000, rate: 0.25 }];
  registerTaxConfig("new", FY, {
    slabs: [
      { from: 0, to: 400000, rate: 0 }, { from: 400000, to: 800000, rate: 0.05 }, { from: 800000, to: 1200000, rate: 0.10 },
      { from: 1200000, to: 1600000, rate: 0.15 }, { from: 1600000, to: 2000000, rate: 0.20 }, { from: 2000000, to: 2400000, rate: 0.25 },
      { from: 2400000, to: Infinity, rate: 0.30 },
    ],
    stdDeduction: 75000, rebateIncomeCap: 1200000, rebateMax: 60000, surchargeBands: surcharge,
  });
  registerTaxConfig("old", FY, {
    slabs: [{ from: 0, to: 250000, rate: 0 }, { from: 250000, to: 500000, rate: 0.05 }, { from: 500000, to: 1000000, rate: 0.20 }, { from: 1000000, to: Infinity, rate: 0.30 }],
    stdDeduction: 50000, rebateIncomeCap: 500000, rebateMax: 12500, surchargeBands: surcharge,
  });
});

/** A flat Special Pay salary: no basic, so no DA / HRA / pension lines. */
const flat = (rupees: number, extra: Record<string, unknown> = {}) => ({
  basicMinor: 0n, pensionScheme: "GPF", taxRegime: "new", fyStartYear: FY, statutoryEsi: false,
  rawComponents: [{ code: "SPL", name: "Special Pay", type: "earning", fixedMinor: R(rupees) }], ...extra,
});
const line = (code: string, type: "earning" | "deduction", rupees: number) => ({ code, name: code, type, amountMinor: R(rupees) });

describe("s.192 projection: every term of the annual estimate", () => {
  it("salary paid + unrecorded months (net of their LOP) + this month less LOP + regular x (remaining - 1) + one-offs once - SD - LTC", () => {
    const s = d.computeSlip(flat(50000, {
      monthsRemaining: 4, tdsYtdMinor: 0n, ltcExemptTotalMinor: R(2000),
      fyPaidToDate: { grossMinor: R(300000), months: 5, unrecordedMonths: 2, unrecordedLopMinor: R(7000) },
      components: [line("ARREAR", "earning", 11000), line("BONUS", "earning", 4000), line("LOP", "deduction", 3000), line("LOAN_EMI", "deduction", 2000)],
    }));
    // 3,00,000 + 50,000 x 2 - 7,000 + (50,000 - 3,000) + 50,000 x 3 + 15,000 - 75,000 - 2,000
    expect(s.annualTaxableMinor).toBe(R(528000));
    expect(s.grossMinor).toBe(R(65000));
  });

  it("unrecorded-month LOP is ignored when there are no unrecorded months", () => {
    const s = d.computeSlip(flat(50000, { monthsRemaining: 4, fyPaidToDate: { grossMinor: R(300000), months: 8, unrecordedMonths: 0, unrecordedLopMinor: R(7000) } }));
    // 3,00,000 + 50,000 x 4 - 75,000
    expect(s.annualTaxableMinor).toBe(R(425000));
  });

  it("a declared previous-employer salary replaces the unrecorded-month estimate (and is itself income)", () => {
    const s = d.computeSlip(flat(50000, {
      monthsRemaining: 4, fyPaidToDate: { grossMinor: 0n, months: 0, unrecordedMonths: 3, unrecordedLopMinor: R(1000) },
      declaration: { prevEmployerSalaryMinor: R(120000) },
    }));
    // 50,000 x 4 + 1,20,000 - 75,000 (the 3 unrecorded months are NOT added)
    expect(s.annualTaxableMinor).toBe(R(245000));
    const none = d.computeSlip(flat(50000, { monthsRemaining: 4, fyPaidToDate: { grossMinor: 0n, months: 0, unrecordedMonths: 3 }, declaration: { prevEmployerSalaryMinor: 0n } }));
    // 50,000 x 7 - 75,000
    expect(none.annualTaxableMinor).toBe(R(275000));
  });

  it("history without monthsRemaining is not a projection (regular x 12 + one-offs once)", () => {
    const s = d.computeSlip(flat(50000, { fyPaidToDate: { grossMinor: R(999999), months: 3 }, components: [line("ARREAR", "earning", 6000), line("LOP", "deduction", 1000)] }));
    // 50,000 x 12 + 6,000 - 75,000 (LOP is a deduction, never a one-off earning)
    expect(s.annualTaxableMinor).toBe(R(531000));
  });

  it("monthsRemaining 1 and 0 both mean the final month (remaining = 1)", () => {
    const hist = { grossMinor: R(550000), months: 11 };
    expect(d.computeSlip(flat(50000, { monthsRemaining: 1, fyPaidToDate: hist })).annualTaxableMinor).toBe(R(525000));
    expect(d.computeSlip(flat(50000, { monthsRemaining: 0, fyPaidToDate: hist })).annualTaxableMinor).toBe(R(525000));
  });

  it("taxable income never goes below zero", () => {
    const s = d.computeSlip(flat(1000, { monthsRemaining: 2, fyPaidToDate: { grossMinor: 0n, months: 0 } }));
    expect(s.annualTaxableMinor).toBe(0n);
    expect(s.tdsMinor).toBe(0n);
  });

  it("true-up: (annual tax - TDS already deducted) / remaining months, rounded to the rupee", () => {
    const s = d.computeSlip(flat(200000, { monthsRemaining: 3, tdsYtdMinor: R(50000), fyPaidToDate: { grossMinor: R(1800000), months: 9 } }));
    // taxable 18,00,000 + 2,00,000 x 3 - 75,000 = 23,25,000
    // tax 20,000 + 40,000 + 60,000 + 80,000 + 25% of 3,25,000 (81,250) = 2,81,250 + 4% = 2,92,500
    expect(s.annualTaxableMinor).toBe(R(2325000));
    // (2,92,500 - 50,000) / 3 = 80,833.33 -> 80,833
    expect(s.tdsMinor).toBe(R(80833));
  });

  it("old regime: HRA exemption and PT are annualised over the FY months actually paid", () => {
    const s = d.computeSlip({
      basicMinor: R(40000), daRateBps: 1000n, cityClass: "Z", pensionScheme: "GPF", taxRegime: "old", fyStartYear: FY, statutoryEsi: false,
      ptMinor: R(200), monthsRemaining: 3, fyPaidToDate: { grossMinor: R(80000), months: 2, unrecordedMonths: 1 },
      declaration: { rentPaidAnnualMinor: R(40000), ded80cMinor: R(50000), ded80dMinor: R(10000), otherDedMinor: R(5000), perquisitesMinor: R(1000) },
    });
    // regular 40,000 + DA 10% 4,000 + HRA Z 8% 3,200 = 47,200; FY months 2 + 1 + 3 = 6
    // gross estimate 80,000 + 47,200 x 1 + 47,200 + 47,200 x 2 = 2,68,800
    // HRA exempt = min(3,200 x 6, 40,000 - 10% of 44,000 x 6, 40%) = min(19,200, 13,600, ...) = 13,600
    // 2,68,800 + 1,000 - 50,000 - 13,600 - 50,000 - 10,000 - 5,000 - 200 x 6 = 1,40,000
    expect(s.hraMinor).toBe(R(3200));
    expect(s.annualTaxableMinor).toBe(R(140000));
  });

  it("statutory deductions add up: PF + ESI + TDS (flat /12 without run context), TDS capped at the pay left (D-02b)", () => {
    const s = d.computeSlip({
      basicMinor: R(15000), cityClass: "X", pensionScheme: "EPF", taxRegime: "new", fyStartYear: FY,
      declaration: { otherSourcesIncomeMinor: R(2000000) },
    });
    // gross 15,000 + HRA 24% 3,600 = 18,600 (<= 21,000: ESI 0.75% = 139.5 -> 140); PF 12% of 15,000 = 1,800
    // taxable 18,600 x 12 + 20,00,000 - 75,000 = 21,48,200; tax 2,00,000 + 25% of 1,48,200 = 2,37,050 + 4% = 2,46,532 -> 2,46,530
    // s.192 TDS 2,46,530 / 12 = 20,544.17 -> 20,544 -- more than the month pays.
    // UAT T-PERIOD D-02b (PR #2459): TDS never exceeds the salary left after the other deductions (no protected-net
    // floor here, default share 100%): cap = 18,600 - (1,800 + 140) = 16,660, so TDS = 16,660, the shortfall
    // 20,544 - 16,660 = 3,884 is reported (tdsShortfallMinor), and total deductions = 1,800 + 140 + 16,660 = 18,600
    // = gross: net exactly 0, not negative (it used to deduct 20,544 and clamp the net).
    expect([s.pfEmployeeMinor, s.esiMinor, s.tdsMinor]).toEqual([R(1800), R(140), R(16660)]);
    expect(s.tdsShortfallMinor).toBe(R(3884));
    expect(s.totalDeductionsMinor).toBe(R(1800 + 140 + 16660));
    expect(s.negativeNet).toBe(false);
    expect(s.netPayMinor).toBe(0n);
  });
});

describe("one-off earnings and LOP", () => {
  it("only ad-hoc EARNINGS are one-offs; only LOP lines reduce the salary for PT", () => {
    const seen: bigint[] = [];
    const s = d.computeSlip(flat(30000, {
      components: [line("REIMB", "earning", 1000), line("LOP", "deduction", 2500), line("LOAN_EMI", "deduction", 700)],
      ptForSalaryMinor: (salary: bigint) => { seen.push(salary); return 20049n; },
    }));
    // PT basis = gross 31,000 - LOP 2,500 (not the EMI) = 28,500; PT rounded 200.49 -> 200
    expect(seen).toEqual([R(28500)]);
    expect(s.ptMinor).toBe(R(200));
    expect(s.deductions.find((x: { code: string }) => x.code === "PT")).toEqual({ code: "PT", name: "Professional Tax", type: "deduction", amountMinor: R(200) });
    // 30,000 x 12 + 1,000 - 75,000
    expect(s.annualTaxableMinor).toBe(R(286000));
  });

  it("ptMinor is used when no resolver is given; no PT line at zero", () => {
    expect(d.computeSlip(flat(30000, { ptMinor: R(150) })).ptMinor).toBe(R(150));
    expect(d.computeSlip(flat(30000)).deductions.some((x: { code: string }) => x.code === "PT")).toBe(false);
  });
});

describe("NPS base: Basic + DA plus the Basic + DA part of arrears", () => {
  it("positive arrear base is added; the base never goes below zero; non-NPS schemes have none", () => {
    const nps = d.computeSlip({ basicMinor: R(30000), daRateBps: 5000n, pensionScheme: "NPS", taxRegime: "new", fyStartYear: FY, statutoryEsi: false, arrearPensionBaseMinor: R(5000) });
    // 30,000 + 15,000 + 5,000 = 50,000 -> 5,000 / 7,000
    expect([nps.npsPensionBaseMinor, nps.npsEmployeeMinor, nps.npsEmployerMinor]).toEqual([R(50000), R(5000), R(7000)]);
    const neg = d.computeSlip({ basicMinor: R(1000), pensionScheme: "NPS", taxRegime: "new", fyStartYear: FY, statutoryEsi: false, arrearPensionBaseMinor: R(-5000) });
    expect([neg.npsPensionBaseMinor, neg.npsEmployeeMinor]).toEqual([0n, 0n]);
    const gpf = d.computeSlip({ basicMinor: R(30000), pensionScheme: "GPF", taxRegime: "new", fyStartYear: FY, statutoryEsi: false, arrearPensionBaseMinor: R(5000) });
    expect([gpf.npsPensionBaseMinor, gpf.gpfMinor]).toEqual([0n, R(3000)]);
  });
});

describe("slip lines, profiles and suspension override", () => {
  it("standard lines carry their statutory names and types; structure DA / HRA entries are ignored", () => {
    const s = d.computeSlip({
      basicMinor: R(20000), daRateBps: 5000n, cityClass: "Y", pensionScheme: "EPF", taxRegime: "new", fyStartYear: FY, statutoryEsi: false,
      rawComponents: [{ code: "DA", name: "x", type: "earning", fixedMinor: R(999) }, { code: "HRA", name: "x", type: "earning", fixedMinor: R(999) }],
    });
    expect(s.earnings).toEqual([
      { code: "BASIC", name: "Basic Pay", type: "earning", amountMinor: R(20000) },
      { code: "DA", name: "Dearness Allowance", type: "earning", amountMinor: R(10000) },
      { code: "HRA", name: "House Rent Allowance", type: "earning", amountMinor: R(4000) },
    ]);
  });

  it("pension scheme defaults to EPF; consolidated pay is EPF with no DA / HRA", () => {
    expect(d.computeSlip({ basicMinor: R(10000), taxRegime: "new", fyStartYear: FY, statutoryEsi: false }).pfEmployeeMinor).toBe(R(1200));
    const c = d.computeSlip({ basicMinor: R(10000), daRateBps: 5000n, pensionScheme: "NPS", payProfile: { kind: "consolidated_contract" }, taxRegime: "new", fyStartYear: FY, statutoryEsi: false });
    expect(c.earnings).toEqual([{ code: "BASIC", name: "Consolidated Emoluments", type: "earning", amountMinor: R(10000) }]);
    expect([c.pfEmployeeMinor, c.npsEmployeeMinor]).toEqual([R(1200), 0n]);
  });

  it("ctc_contract is refused with a coded DomainError", () => {
    let err: { code?: string; name?: string; message?: string } = {};
    try { d.computeSlip({ basicMinor: R(1), payProfile: { kind: "ctc_contract" }, taxRegime: "new", fyStartYear: FY }); } catch (e) { err = e as typeof err; }
    expect(err.code).toBe("CTC_PROFILE_NOT_SUPPORTED");
    expect(err.name).toBe("DomainError");
    expect(err.message).toBe("[CTC_PROFILE_NOT_SUPPORTED] ctc_contract slips are computed by the CTC module (PAY-PROFILES PR3)");
  });

  it("Option A deputation pays DEP_ALLOW (min of % of basic and the cap), or nothing at zero", () => {
    const allowance = { mode: "auto", fixedMinor: R(100), stationType: "other", rule: { rateBps: 1000n, capMinor: R(3000) } };
    const s = d.computeSlip({ basicMinor: R(20000), payProfile: { kind: "deputation_parent_scale", allowance }, pensionScheme: "GPF", taxRegime: "new", fyStartYear: FY, statutoryEsi: false });
    expect(s.earnings.find((x: { code: string }) => x.code === "DEP_ALLOW")).toEqual({ code: "DEP_ALLOW", name: "Deputation (Duty) Allowance", type: "earning", amountMinor: R(2000) });
    const zero = d.computeSlip({ basicMinor: R(20000), payProfile: { kind: "deputation_parent_scale", allowance: { ...allowance, mode: "fixed", fixedMinor: 0n } }, pensionScheme: "GPF", taxRegime: "new", fyStartYear: FY, statutoryEsi: false });
    expect(zero.earnings.some((x: { code: string }) => x.code === "DEP_ALLOW")).toBe(false);
  });

  it("deputationAllowanceMinor: computed (capped) only with mode auto + rule + station, else the fixed amount", () => {
    const rule = { rateBps: 1000n, capMinor: R(3000) };
    expect(d.deputationAllowanceMinor(R(20000), { mode: "auto", fixedMinor: R(500), stationType: "same", rule })).toEqual({ amountMinor: R(2000), basis: "computed" });
    expect(d.deputationAllowanceMinor(R(50000), { mode: "auto", fixedMinor: R(500), stationType: "same", rule })).toEqual({ amountMinor: R(3000), basis: "computed" });
    expect(d.deputationAllowanceMinor(R(20000), { mode: "fixed", fixedMinor: 50049n, stationType: "same", rule })).toEqual({ amountMinor: R(500), basis: "fixed" });
    expect(d.deputationAllowanceMinor(R(20000), { mode: "auto", fixedMinor: R(500), stationType: null, rule })).toEqual({ amountMinor: R(500), basis: "fixed" });
    expect(d.deputationAllowanceMinor(R(20000), { mode: "auto", fixedMinor: R(500), stationType: "same", rule: null })).toEqual({ amountMinor: R(500), basis: "fixed" });
  });

  it("FR 53 earnings override: its lines go to earnings / deductions by type, its DA / HRA / pension base are used", () => {
    const s = d.computeSlip({
      basicMinor: R(10000), pensionScheme: "GPF", taxRegime: "new", fyStartYear: FY, statutoryEsi: false,
      earningsOverride: {
        components: [line("BASIC", "earning", 5000), line("SUBSISTENCE_ALLOWANCE", "earning", 4000), line("WELFARE", "deduction", 100)],
        daMinor: R(2500), hraMinor: R(1200), pensionBaseMinor: R(7000), hraSalaryMinor: R(9000),
      },
    });
    expect(s.earnings.map((x: { code: string }) => x.code)).toEqual(["BASIC", "SUBSISTENCE_ALLOWANCE"]);
    expect(s.deductions).toEqual([line("WELFARE", "deduction", 100)]);
    expect([s.daMinor, s.hraMinor, s.gpfMinor, s.grossMinor]).toEqual([R(2500), R(1200), R(700), R(9000)]);
  });

  it("HRA floor: applies when the slab is below it, never to a zero basic", () => {
    expect(d.govtHraMinor(R(10000), "X", 0n, R(5400))).toBe(R(5400));
    expect(d.govtHraMinor(R(30000), "X", 0n, R(5400))).toBe(R(7200));
    expect(d.govtHraMinor(0n, "X", 0n, R(5400))).toBe(0n);
  });
});

describe("protected-net floor: recovery trimmed largest line first", () => {
  it("partial trim of the largest recovery line, remainder carried forward", () => {
    const s = d.computeSlip(flat(20000, { protectedNetFloorMinor: R(14000), components: [line("ARREAR_RECOVERY", "deduction", 3000), line("LOAN_EMI", "deduction", 5000)] }));
    // headroom 20,000 - 14,000 = 6,000 of 8,000: carry 2,000 off the EMI (largest)
    expect(s.recoveryCarryForwardMinor).toBe(R(2000));
    expect(s.deductions).toEqual([line("ARREAR_RECOVERY", "deduction", 3000), line("LOAN_EMI", "deduction", 3000)]);
    expect([s.netPayMinor, s.negativeNet]).toEqual([R(14000), false]);
  });

  it("a fully trimmed line is dropped and the next one absorbs the rest", () => {
    const s = d.computeSlip(flat(20000, { protectedNetFloorMinor: R(18000), components: [line("ARREAR_RECOVERY", "deduction", 3000), line("LOAN_EMI", "deduction", 5000)] }));
    // headroom 2,000 of 8,000: carry 6,000 = EMI 5,000 (dropped) + 1,000 off the recovery
    expect(s.recoveryCarryForwardMinor).toBe(R(6000));
    expect(s.deductions).toEqual([line("ARREAR_RECOVERY", "deduction", 2000)]);
    expect(s.netPayMinor).toBe(R(18000));
  });

  it("net exactly zero is not a negative net", () => {
    const s = d.computeSlip(flat(5000, { components: [line("LOAN_EMI", "deduction", 9000)] }));
    expect([s.netPayMinor, s.negativeNet, s.recoveryCarryForwardMinor]).toEqual([0n, false, R(4000)]);
  });
});

describe("unrecorded FY months (DOJ-aware)", () => {
  it("count: in service from the later of April and joining, less recorded months, never negative", () => {
    expect(d.unrecordedFyMonths(2026, "2027-03", "2019-06-01", 2)).toBe(9);
    expect(d.unrecordedFyMonths(2026, "2026-07", null, 0)).toBe(3);
    expect(d.unrecordedFyMonths(2026, "2026-07", undefined, 1)).toBe(2);
    expect(d.unrecordedFyMonths(2026, "2026-07", "2026-05-20", 0)).toBe(2);
    expect(d.unrecordedFyMonths(2026, "2026-07", "2026-09-01", 0)).toBe(0);
    expect(d.unrecordedFyMonths(2026, "2026-07", null, 5)).toBe(0);
    expect(d.unrecordedFyMonths(2027, "2028-02", "2027-12-01", 0)).toBe(2);
    // not a YYYY-MM date: in service for the whole FY
    expect(d.unrecordedFyMonths(2026, "2026-07", "x2026-06-01", 0)).toBe(3);
    expect(d.unrecordedFyMonths(2026, "2026-07", "2026-6-01", 0)).toBe(3);
    expect(d.unrecordedFyMonths(2026, "2026-07", "2026-1x-01", 0)).toBe(3);
  });

  it("list: the in-service months with no recorded regular slip", () => {
    expect(d.unrecordedFyMonthList(2026, "2026-11", "2019-01-01", ["2026-04", "2026-05", "2026-08"])).toEqual(["2026-06", "2026-07", "2026-09", "2026-10"]);
    expect(d.unrecordedFyMonthList(2026, "2027-02", "2026-11-15", [])).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(d.unrecordedFyMonthList(2026, "2026-04", null, [])).toEqual([]);
    expect(d.unrecordedFyMonthList(2026, "2026-06", "x2026-05-01", [])).toEqual(["2026-04", "2026-05"]);
    expect(d.unrecordedFyMonthList(2026, "2026-06", "2026-5-01", [])).toEqual(["2026-04", "2026-05"]);
    expect(d.unrecordedFyMonthList(2026, "2026-06", "2026-0x-01", [])).toEqual(["2026-04", "2026-05"]);
    expect(d.unrecordedFyMonthList(2026, "2026-06", "2026-08-01", [])).toEqual([]);
  });
});

describe("pensioner s.192 estimate", () => {
  it("paid + current x (unrecorded + remaining), remaining at least 1, unrecorded at least 0", () => {
    const fyPaid = { grossMinor: R(300000), months: 2 };
    expect(d.pensionAnnualGrossEstimateMinor({ currentGrossMinor: R(150000), fyPaid, unrecordedMonths: 2, monthsRemaining: 4 })).toBe(R(300000 + 150000 * 6));
    expect(d.pensionAnnualGrossEstimateMinor({ currentGrossMinor: R(150000), fyPaid, unrecordedMonths: 0, monthsRemaining: 0 })).toBe(R(450000));
    expect(d.pensionAnnualGrossEstimateMinor({ currentGrossMinor: R(150000), fyPaid, unrecordedMonths: -3, monthsRemaining: 2 })).toBe(R(600000));
  });
});

describe("arrears review", () => {
  const slip = (id: string, no: string, gross: number, comps: Array<{ code: string; type: string; amountMinor: number }> | null) =>
    ({ employeeId: id, employeeNo: no, grossMinor: R(gross), components: comps });
  const c = (code: string, rupees: number, type = "earning") => ({ code, type, amountMinor: rupees * 100 });

  it("per-employee arrears, regular gross net of arrears / bonus / reimbursements, sorted, totalled", () => {
    const r = d.arrearsReviewOf([
      slip("b", "B-2", 80000, [c("BASIC", 50000), c("ARREAR", 20000), c("BONUS", 6000), c("REIMB", 4000)]),
      slip("a", "A-1", 60000, [c("BASIC", 50000), c("ARREAR", 4000), c("ARREAR", 6000)]),
      slip("z", "Z-0", 50000, [c("BASIC", 50000), c("ARREAR", 999, "deduction")]),
      slip("n", "N-0", 0, null),
    ], 10000);
    expect(r.totalArrearsMinor).toBe(R(30000));
    expect(r.employees).toEqual([
      { employeeId: "a", employeeNo: "A-1", arrearsMinor: R(10000), regularGrossMinor: R(50000), requiresReview: false },
      { employeeId: "b", employeeNo: "B-2", arrearsMinor: R(20000), regularGrossMinor: R(50000), requiresReview: false },
    ]);
  });

  it("review is needed strictly ABOVE threshold x regular gross; a non-positive regular gross always needs review", () => {
    const at = d.arrearsReviewOf([slip("e", "E", 100000, [c("ARREAR", 50000)])], 10000);
    expect(at.employees[0].requiresReview).toBe(false); // 50,000 = 1 x 50,000
    const above = d.arrearsReviewOf([{ employeeId: "e", employeeNo: "E", grossMinor: R(100000) + 1n, components: [{ code: "ARREAR", type: "earning", amountMinor: 5000001 }] }], 10000);
    expect(above.employees[0].requiresReview).toBe(true); // 50,000.01 > 1 x 50,000
    expect(d.arrearsReviewOf([slip("e", "E", 100000, [c("ARREAR", 50000)])], 5000).employees[0].requiresReview).toBe(true);
    expect(d.arrearsReviewOf([slip("e", "E", 100000, [c("ARREAR", 50000)])], 20000).employees[0].requiresReview).toBe(false);
    const neg = d.arrearsReviewOf([slip("f", "F", 1000, [c("ARREAR", 1000), c("BONUS", 500)])], 10000);
    expect(neg.employees[0]).toEqual({ employeeId: "f", employeeNo: "F", arrearsMinor: R(1000), regularGrossMinor: R(-500), requiresReview: true });
  });

  it("slipsCarryArrears: only an ARREAR earning counts", () => {
    expect(d.slipsCarryArrears([{ components: [{ code: "ARREAR", type: "earning" }] }])).toBe(true);
    expect(d.slipsCarryArrears([{ components: [{ code: "ARREAR", type: "deduction" }] }, { components: [{ code: "BONUS", type: "earning" }] }, { components: null }])).toBe(false);
    expect(d.slipsCarryArrears([])).toBe(false);
  });

  it("unacknowledgedArrears: needs review and no non-blank acknowledgement", () => {
    const employees = [
      { employeeId: "a", employeeNo: "A", arrearsMinor: 1n, regularGrossMinor: 1n, requiresReview: true },
      { employeeId: "b", employeeNo: "B", arrearsMinor: 1n, regularGrossMinor: 1n, requiresReview: true },
      { employeeId: "c", employeeNo: "C", arrearsMinor: 1n, regularGrossMinor: 1n, requiresReview: false },
    ];
    expect(d.unacknowledgedArrears({ employees }, [{ employeeId: "a", reason: "checked order" }, { employeeId: "b", reason: "   " }]).map((e: { employeeId: string }) => e.employeeId)).toEqual(["b"]);
    expect(d.unacknowledgedArrears({ employees }).map((e: { employeeId: string }) => e.employeeId)).toEqual(["a", "b"]);
  });

  it("arrearsReviewMessage lists up to 20 employees with whole-rupee amounts", () => {
    expect(d.arrearsReviewMessage([{ employeeNo: "A-1", arrearsMinor: 6000099n }])).toBe(
      "1 employee(s) have arrears above the review threshold: A-1 (Rs 60000). Check them and approve with arrearsAcknowledgements [{ employeeId, reason }] for each of them");
    const many = Array.from({ length: 21 }, (_v, i) => ({ employeeNo: `E${i}`, arrearsMinor: 100n }));
    const m21 = d.arrearsReviewMessage(many);
    expect(m21.startsWith("21 employee(s) have arrears above the review threshold: E0 (Rs 1), E1 (Rs 1)")).toBe(true);
    expect(m21).toContain("E19 (Rs 1), ...");
    expect(m21).not.toContain("E20");
    expect(d.arrearsReviewMessage(many.slice(0, 20))).not.toContain("...");
  });
});

describe("zero-basic approval helpers", () => {
  it("zeroBasicSlipsOf: basic 0 and not an FR 53 subsistence slip", () => {
    const slips = [
      { id: "1", basicMinor: 0n, components: [] },
      { id: "2", basicMinor: 0n, components: [{ code: "SUBSISTENCE_ALLOWANCE" }] },
      { id: "3", basicMinor: 1n, components: [] },
      { id: "4", basicMinor: 0n, components: null },
      { id: "5", basicMinor: 0n, components: [{ code: "TA" }] },
    ];
    expect(d.zeroBasicSlipsOf(slips).map((s: { id: string }) => s.id)).toEqual(["1", "4", "5"]);
  });

  it("exclusions: only non-blank reasons exclude; invalid ones name no zero-basic slip", () => {
    const zero = [{ employeeId: "z1" }, { employeeId: "z2" }];
    expect(d.unexcludedZeroBasicSlips(zero, [{ employeeId: "z1", reason: "HRMS basic missing" }, { employeeId: "z2", reason: " " }])).toEqual([{ employeeId: "z2" }]);
    expect(d.unexcludedZeroBasicSlips(zero)).toEqual(zero);
    expect(d.invalidZeroBasicExclusions(zero, [{ employeeId: "z1", reason: "x" }, { employeeId: "p9", reason: "y" }])).toEqual([{ employeeId: "p9", reason: "y" }]);
    expect(d.invalidZeroBasicExclusions(zero)).toEqual([]);
  });

  it("messages and codes", () => {
    expect(d.zeroBasicSlipsMessage([{ employeeNo: "Z-1" }, { employeeNo: "Z-2" }])).toBe(
      "2 slip(s) in this run have no basic pay (HRMS basic missing): Z-1, Z-2. Fix the basic pay in HRMS and re-run, or approve with zeroBasicExclusions [{ employeeId, reason }] for each of them");
    const many = Array.from({ length: 21 }, (_v, i) => ({ employeeNo: `Z${i}` }));
    expect(d.zeroBasicSlipsMessage(many)).toContain("Z19, ...");
    expect(d.zeroBasicSlipsMessage(many.slice(0, 20))).not.toContain("...");
    expect([d.ZERO_BASIC_SLIPS, d.ARREARS_REVIEW_REQUIRED, d.INVALID_ZERO_BASIC_EXCLUSION, d.DEFAULT_ARREARS_REVIEW_THRESHOLD_BPS])
      .toEqual(["ZERO_BASIC_SLIPS", "ARREARS_REVIEW_REQUIRED", "INVALID_ZERO_BASIC_EXCLUSION", 10000]);
  });
});

describe("pension, age and run lifecycle", () => {
  it("ageAtMonth: birthday on or before the last day of the run month; never negative", () => {
    expect(d.ageAtMonth("1950-03-31", "2026-03")).toBe(76);
    expect(d.ageAtMonth("1950-04-01", "2026-03")).toBe(75);
    expect(d.ageAtMonth("1950-03-31", "2026-02")).toBe(75);
    expect(d.ageAtMonth("2030-01-01", "2026-03")).toBe(0);
  });

  it("computePension lists every non-zero line with its name, and no zero line", () => {
    const p = d.computePension({
      basicPensionMinor: R(40000), drRateBps: 5000n, commutedPensionMinor: R(8000), commutationDate: "2016-01-10",
      medicalAllowanceMinor: R(1000), dateOfBirth: "1944-01-01", month: "2026-03", tdsMinor: R(500),
    });
    // age 82 -> additional 20% = 8,000; DR 50% of 48,000 = 24,000; commutation not yet restored (2031)
    expect(p.earnings).toEqual([
      { code: "BASIC_PENSION", name: "Basic Pension", type: "earning", amountMinor: R(40000) },
      { code: "ADDL_PENSION", name: "Additional Pension (20%)", type: "earning", amountMinor: R(8000) },
      { code: "DR", name: "Dearness Relief", type: "earning", amountMinor: R(24000) },
      { code: "FMA", name: "Medical Allowance", type: "earning", amountMinor: R(1000) },
    ]);
    expect(p.deductions).toEqual([
      { code: "COMMUTATION", name: "Commuted Pension", type: "deduction", amountMinor: R(8000) },
      { code: "TDS", name: "Income Tax (TDS)", type: "deduction", amountMinor: R(500) },
    ]);
    const bare = d.computePension({ basicPensionMinor: R(40000), dateOfBirth: "1960-01-01", month: "2026-03" });
    expect(bare.earnings.map((x: { code: string }) => x.code)).toEqual(["BASIC_PENSION"]);
    expect(bare.deductions).toEqual([]);
  });

  it("commutation is restored on the 15th anniversary; commuted with no date is not restored", () => {
    const base = { basicPensionMinor: R(40000), commutedPensionMinor: R(8000), dateOfBirth: "1960-01-01" };
    expect(d.computePension({ ...base, commutationDate: "2011-03-31", month: "2026-03" }).commutationRestored).toBe(true);
    expect(d.computePension({ ...base, commutationDate: "2011-03-31", month: "2026-02" }).commutationRestored).toBe(false);
    expect(d.computePension({ ...base, commutationDate: null, month: "2026-03" }).commutationDeductionMinor).toBe(R(8000));
    expect(d.computePension({ ...base, commutedPensionMinor: 0n, commutationDate: null, month: "2026-03" }).commutationRestored).toBe(true);
  });

  it("run status transitions: disbursed is terminal; unknown states are refused with a coded error", () => {
    // UAT L2-N3 (bundle 16): a run is approvable only once its computation has
    // finished (computed); processing -> approved is refused with the coded error;
    // a payroll admin may send a computed run back (computed -> failed).
    expect(() => d.assertRunStatusTransition("processing", "computed")).not.toThrow();
    expect(() => d.assertRunStatusTransition("computed", "approved")).not.toThrow();
    expect(() => d.assertRunStatusTransition("computed", "failed")).not.toThrow();
    let early: { code?: string; message?: string } = {};
    try { d.assertRunStatusTransition("processing", "approved"); } catch (e) { early = e as typeof early; }
    expect(early.code).toBe("INVALID_STATUS_TRANSITION");
    expect(early.message).toMatch(/cannot move payroll run from .processing. to .approved./);
    for (const next of ["draft", "processing", "computed", "approved", "failed"]) {
      expect(() => d.assertRunStatusTransition("disbursed", next), next).toThrow(/INVALID_STATUS_TRANSITION/);
    }
    let err: { code?: string; message?: string } = {};
    try { d.assertRunStatusTransition("disbursed", "approved"); } catch (e) { err = e as typeof err; }
    expect(err.code).toBe("INVALID_STATUS_TRANSITION");
    expect(err.message).toMatch(/cannot move payroll run from .disbursed. to .approved./);
    expect(() => d.assertRunStatusTransition("weird", "draft")).toThrow(/INVALID_STATUS_TRANSITION/);
  });

  it("statutory config: a row effective on the 1st of the period applies; the latest wins", () => {
    const row = (from: string, cap: number) => ({ ...d.DEFAULT_STATUTORY_CONFIG, tenantId: "t", effectiveFrom: from, pfWageCapMinor: R(cap) });
    expect(d.resolveStatutoryConfig([row("2026-08-01", 21000), row("2026-04-01", 18000)], "t", "2026-08").pfWageCapMinor).toBe(R(21000));
    expect(d.resolveStatutoryConfig([row("2026-04-01", 18000), row("2026-08-01", 21000)], "t", "2026-07").pfWageCapMinor).toBe(R(18000));
  });
});
