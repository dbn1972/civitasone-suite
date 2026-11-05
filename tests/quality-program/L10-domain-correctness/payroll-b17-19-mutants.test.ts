/**
 * L10 -- Domain Correctness: bundle 17-19 payroll domain code (PRs #2458, #2459)
 * mutation burn-down for services/payroll-service/src/modules/payroll/domain.ts,
 * plus the bundle 16 run lifecycle rule (#2454) that shares the file.
 *
 * Covers the EPS eligibility decision, the EPF employer charges (EDLI, A/c 2),
 * the UPS pool share, the s.192 true-up with presumed months, the TDS cap and
 * deduction-share ceiling, the presumption boundary, the TDS / net-pay approval
 * review and the run state machine. Every expected value is worked out BY HAND
 * from the rule or the documented constants (shown in comments), never read back
 * from the implementation:
 *   roundRupee(x) = floor((x + 50) / 100) * 100 (paise, half-up)
 *   default statutory config: PF wage cap Rs 15,000, EDLI 0.50% on wages up to
 *   Rs 15,000, EPF admin 0.50% with a Rs 500 minimum, EPS cut-off 01.09.2014,
 *   EPS joining-wage ceiling Rs 15,000, UPS pool 8.5%.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");
const R = (rupees: number): bigint => BigInt(Math.round(rupees * 100));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let d: any;

beforeAll(async () => {
  d = await import(`${REPO_ROOT}/services/payroll-service/src/modules/payroll/domain.js`);
  const { registerTaxConfig } = await import(`${REPO_ROOT}/services/payroll-service/src/modules/tax/engine.js`);
  registerTaxConfig("new", 2026, {
    slabs: [
      { from: 0, to: 400000, rate: 0 }, { from: 400000, to: 800000, rate: 0.05 }, { from: 800000, to: 1200000, rate: 0.10 },
      { from: 1200000, to: 1600000, rate: 0.15 }, { from: 1600000, to: 2000000, rate: 0.20 }, { from: 2000000, to: 2400000, rate: 0.25 },
      { from: 2400000, to: Infinity, rate: 0.30 },
    ],
    stdDeduction: 75000, rebateIncomeCap: 1200000, rebateMax: 60000, surchargeBands: [],
  });
});

describe("EPS eligibility: decided only from recorded facts, in a fixed order", () => {
  it("58 or older before the month: not eligible, whatever else is recorded", () => {
    expect(d.epsEligibility({ ageCutoffReached: true, epsMember: true, firstJoinedOn: "2010-01-01" }, "2020-01-01")).toEqual({ eligible: false, recorded: true });
  });
  it("an explicit epsMember wins over the joint option and the dates, both ways", () => {
    expect(d.epsEligibility({ epsMember: true, voluntaryJointOption: true }, "2020-01-01")).toEqual({ eligible: true, recorded: true });
    expect(d.epsEligibility({ epsMember: false, firstJoinedOn: "2010-01-01" }, "2020-01-01")).toEqual({ eligible: false, recorded: true });
  });
  it("para 26(6) joint option: not eligible even when first in EPF before the cut-off", () => {
    expect(d.epsEligibility({ voluntaryJointOption: true, firstJoinedOn: "2010-01-01" }, "2020-01-01")).toEqual({ eligible: false, recorded: true });
  });
  it("first in EPF before 01.09.2014 is eligible; the cut-off day itself is not 'before'", () => {
    expect(d.epsEligibility({ firstJoinedOn: "2014-08-31" }, "2020-01-01")).toEqual({ eligible: true, recorded: true });
    expect(d.epsEligibility({ firstJoinedOn: "2014-09-01" }, "2020-01-01")).toEqual({ eligible: true, recorded: false });
  });
  it("with no recorded first-joining date the joining date stands in for it", () => {
    expect(d.epsEligibility({}, "2014-08-31")).toEqual({ eligible: true, recorded: true });
    expect(d.epsEligibility({ firstJoinedOn: null }, "2014-09-01")).toEqual({ eligible: true, recorded: false });
    // a recorded earlier date beats a later joining date
    expect(d.epsEligibility({ firstJoinedOn: "2013-01-01" }, "2020-01-01")).toEqual({ eligible: true, recorded: true });
  });
  it("joining wage recorded: eligible iff at most Rs 15,000 (1,500,000 paise), any numeric type", () => {
    expect(d.epsEligibility({ firstJoinedOn: "2020-01-01", joiningWageMinor: 1_500_000n }, "2020-01-01")).toEqual({ eligible: true, recorded: true });
    expect(d.epsEligibility({ firstJoinedOn: "2020-01-01", joiningWageMinor: 1_500_001n }, "2020-01-01")).toEqual({ eligible: false, recorded: true });
    expect(d.epsEligibility({ firstJoinedOn: "2020-01-01", joiningWageMinor: "1500001" }, "2020-01-01")).toEqual({ eligible: false, recorded: true });
    expect(d.epsEligibility({ firstJoinedOn: "2020-01-01", joiningWageMinor: 1_500_000 }, "2020-01-01")).toEqual({ eligible: true, recorded: true });
    expect(d.epsEligibility({ firstJoinedOn: "2020-01-01", joiningWageMinor: 0 }, "2020-01-01")).toEqual({ eligible: true, recorded: true });
  });
  it("nothing recorded: treated as an EPS member and flagged unrecorded", () => {
    expect(d.epsEligibility({}, "2020-01-01")).toEqual({ eligible: true, recorded: false });
    expect(d.EPS_ELIGIBILITY_UNRECORDED).toBe("EPS_ELIGIBILITY_UNRECORDED");
    expect(d.EPS_WAGE_CEILING_MINOR).toBe(1_500_000n);
    expect(d.EPS_CUTOFF_DATE).toBe("2014-09-01");
  });
});

describe("EPF employer charges (EDLI and A/c 2) and the UPS pool share", () => {

  it("above the Rs 15,000 wage cap both charges are on the cap: 0.5% of Rs 15,000 = Rs 75 each", () => {
    const c = d.epfEmployerCharges(R(20000), d.DEFAULT_STATUTORY_CONFIG);
    expect(c).toEqual({ pfWageMinor: R(15000), edliWageMinor: R(15000), edliMinor: R(75), epfAdminMinor: R(75) });
  });
  it("on the cap exactly, and below it (Rs 10,000 -> Rs 50)", () => {
    expect(d.epfEmployerCharges(R(15000), d.DEFAULT_STATUTORY_CONFIG)).toEqual({ pfWageMinor: R(15000), edliWageMinor: R(15000), edliMinor: R(75), epfAdminMinor: R(75) });
    expect(d.epfEmployerCharges(R(10000), d.DEFAULT_STATUTORY_CONFIG)).toEqual({ pfWageMinor: R(10000), edliWageMinor: R(10000), edliMinor: R(50), epfAdminMinor: R(50) });
  });
  it("a zero or negative base carries no charge", () => {
    const zero = { pfWageMinor: 0n, edliWageMinor: 0n, edliMinor: 0n, epfAdminMinor: 0n };
    expect(d.epfEmployerCharges(0n, d.DEFAULT_STATUTORY_CONFIG)).toEqual(zero);
    expect(d.epfEmployerCharges(-500n, d.DEFAULT_STATUTORY_CONFIG)).toEqual(zero);
  });
  it("each charge rounds to the rupee on its own: 12,345.67 x 0.5% = 61.73 -> Rs 62", () => {
    // 1,234,567 x 50 / 10000 = 6,172.8 -> 6,172 paise -> nearest rupee 6,200
    const c = d.epfEmployerCharges(1_234_567n, d.DEFAULT_STATUTORY_CONFIG);
    expect(c.edliMinor).toBe(6200n);
    expect(c.epfAdminMinor).toBe(6200n);
  });
  it("the wage caps and the two rates are separate settings", () => {
    const own = { ...d.DEFAULT_STATUTORY_CONFIG, pfWageCapMinor: 1_000_000n, edliWageCapMinor: 800_000n, edliRateBps: 100n, epfAdminRateBps: 200n };
    // base 12,000: A/c 2 on min(12,000, 10,000) at 2% = 200; EDLI on min(12,000, 8,000) at 1% = 80
    expect(d.epfEmployerCharges(R(12000), own)).toEqual({ pfWageMinor: R(10000), edliWageMinor: R(8000), edliMinor: R(80), epfAdminMinor: R(200) });
  });

  it("A/c 2 for the month: nothing without members; otherwise at least the Rs 500 minimum", () => {
    expect(d.epfAdminChargeForPeriod(R(300), 0, d.DEFAULT_STATUTORY_CONFIG)).toBe(0n);
    expect(d.epfAdminChargeForPeriod(R(300), -2, d.DEFAULT_STATUTORY_CONFIG)).toBe(0n);
    expect(d.epfAdminChargeForPeriod(R(499.99), 1, d.DEFAULT_STATUTORY_CONFIG)).toBe(R(500));
    expect(d.epfAdminChargeForPeriod(R(500), 1, d.DEFAULT_STATUTORY_CONFIG)).toBe(R(500));
    expect(d.epfAdminChargeForPeriod(R(600), 3, d.DEFAULT_STATUTORY_CONFIG)).toBe(R(600));
    expect(d.epfAdminChargeForPeriod(R(100), 1, { ...d.DEFAULT_STATUTORY_CONFIG, epfAdminMinMinor: R(75) })).toBe(R(100));
    expect(d.epfAdminChargeForPeriod(R(50), 1, { ...d.DEFAULT_STATUTORY_CONFIG, epfAdminMinMinor: R(75) })).toBe(R(75));
  });

  it("UPS pool share is 8.5% of the pension base, to the rupee, and nothing at or below zero", () => {
    expect(d.UPS_POOL_BPS).toBe(850n);
    // 79,000 x 8.5% = 6,715
    expect(d.upsPoolShareMinor(R(79000))).toBe(R(6715));
    expect(d.upsPoolShareMinor(R(10000))).toBe(R(850));
    // 12,345.67 x 8.5% = 1,049.38 -> Rs 1,049
    expect(d.upsPoolShareMinor(1_234_567n)).toBe(104_900n);
    expect(d.upsPoolShareMinor(0n)).toBe(0n);
    expect(d.upsPoolShareMinor(-100n)).toBe(0n);
  });
});

describe("s.192 monthly TDS with presumed months (D-02b)", () => {
  const annual = R(12000);
  it("no presumed months: the balance over the months left", () => {
    expect(d.s192MonthlyTds({ annualTaxMinor: annual, tdsDeductedMinor: 0n, monthsRemaining: 12 })).toEqual({ tdsMinor: R(1000), liabilityMinor: annual, excessMinor: 0n });
  });
  it("3 of 12 months presumed deducted at the average rate leave 9/12 of the tax over 9 months", () => {
    // presumed 12,000 x 3/12 = 3,000; liability 9,000; 9,000 / 9 = 1,000
    expect(d.s192MonthlyTds({ annualTaxMinor: annual, tdsDeductedMinor: 0n, monthsRemaining: 9, presumedMonths: 3n })).toEqual({ tdsMinor: R(1000), liabilityMinor: R(9000), excessMinor: 0n });
  });
  it("the presumed share is a whole rupee: Rs 10,000 x 1/12 = 833.33 -> 833", () => {
    expect(d.s192MonthlyTds({ annualTaxMinor: R(10000), tdsDeductedMinor: 0n, monthsRemaining: 11, presumedMonths: 1n }).liabilityMinor).toBe(R(10000) - R(833));
  });
  it("presumed months cannot exceed the FY months; zero or negative count as none", () => {
    expect(d.s192MonthlyTds({ annualTaxMinor: annual, tdsDeductedMinor: 0n, monthsRemaining: 3, presumedMonths: 20n }).liabilityMinor).toBe(0n);
    expect(d.s192MonthlyTds({ annualTaxMinor: annual, tdsDeductedMinor: 0n, monthsRemaining: 12, presumedMonths: 0n }).liabilityMinor).toBe(annual);
    expect(d.s192MonthlyTds({ annualTaxMinor: annual, tdsDeductedMinor: 0n, monthsRemaining: 12, presumedMonths: -2n }).liabilityMinor).toBe(annual);
  });
  it("a shorter FY (8 months) scales the presumed share: 2/8 of 8,000 = 2,000", () => {
    expect(d.s192MonthlyTds({ annualTaxMinor: R(8000), tdsDeductedMinor: 0n, monthsRemaining: 6, presumedMonths: 2n, fyMonths: 8n }).liabilityMinor).toBe(R(6000));
    // fyMonths 0 falls back to 12
    expect(d.s192MonthlyTds({ annualTaxMinor: annual, tdsDeductedMinor: 0n, monthsRemaining: 9, presumedMonths: 3n, fyMonths: 0n }).liabilityMinor).toBe(R(9000));
  });
  it("a negative annual tax is no liability", () => {
    expect(d.s192MonthlyTds({ annualTaxMinor: -R(500), tdsDeductedMinor: 0n, monthsRemaining: 5 })).toEqual({ tdsMinor: 0n, liabilityMinor: 0n, excessMinor: 0n });
  });
  it("TDS already deducted above the liability is an excess and no TDS this month; equal is no excess", () => {
    expect(d.s192MonthlyTds({ annualTaxMinor: annual, tdsDeductedMinor: R(15000), monthsRemaining: 4 })).toEqual({ tdsMinor: 0n, liabilityMinor: annual, excessMinor: R(3000) });
    expect(d.s192MonthlyTds({ annualTaxMinor: annual, tdsDeductedMinor: annual, monthsRemaining: 4 }).excessMinor).toBe(0n);
  });
  it("the final month takes the whole balance, rounded to the rupee: 12,345.67 -> 12,346; months 0 is the final month", () => {
    expect(d.s192MonthlyTds({ annualTaxMinor: 1_234_567n, tdsDeductedMinor: 0n, monthsRemaining: 1 }).tdsMinor).toBe(1_234_600n);
    expect(d.s192MonthlyTds({ annualTaxMinor: 1_234_567n, tdsDeductedMinor: 0n, monthsRemaining: 0 }).tdsMinor).toBe(1_234_600n);
  });
});

describe("TDS cap for the month (D-02b) and the deduction share", () => {
  it("never more than the salary left after the other deductions: 18,600 - 1,940 = 16,660", () => {
    expect(d.tdsCapForMonthMinor({ grossMinor: R(18600), otherDeductionsMinor: R(1940) })).toBe(R(16660));
  });
  it("the protected-net floor comes off too", () => {
    expect(d.tdsCapForMonthMinor({ grossMinor: R(18600), otherDeductionsMinor: R(1940), protectedNetFloorMinor: R(1000) })).toBe(R(15660));
  });
  it("the share ceiling binds when lower: 50% of 18,600 = 9,300 less 1,940 = 7,360", () => {
    expect(d.tdsCapForMonthMinor({ grossMinor: R(18600), otherDeductionsMinor: R(1940), maxDeductionShareBps: 5000 })).toBe(R(7360));
    // floor 1,000 and 50%: min(15,660, 7,360)
    expect(d.tdsCapForMonthMinor({ grossMinor: R(18600), otherDeductionsMinor: R(1940), protectedNetFloorMinor: R(1000), maxDeductionShareBps: 5000 })).toBe(R(7360));
    // 95% share: 17,670 - 1,940 = 15,730 vs floor 16,660 - 1,500 = 15,160 -> floor binds
    expect(d.tdsCapForMonthMinor({ grossMinor: R(18600), otherDeductionsMinor: R(1940), protectedNetFloorMinor: R(1500), maxDeductionShareBps: 9500 })).toBe(R(15160));
  });
  it("the share is clamped to 0..10000 bps and truncated", () => {
    expect(d.tdsCapForMonthMinor({ grossMinor: R(1000), otherDeductionsMinor: 0n, maxDeductionShareBps: 20000 })).toBe(R(1000));
    expect(d.tdsCapForMonthMinor({ grossMinor: R(1000), otherDeductionsMinor: 0n, maxDeductionShareBps: -50 })).toBe(0n);
    expect(d.tdsCapForMonthMinor({ grossMinor: R(1000), otherDeductionsMinor: 0n, maxDeductionShareBps: 2500.9 })).toBe(R(250));
  });
  it("whole rupees rounded down, and never negative", () => {
    expect(d.tdsCapForMonthMinor({ grossMinor: 1_000_050n, otherDeductionsMinor: 0n })).toBe(1_000_000n);
    expect(d.tdsCapForMonthMinor({ grossMinor: R(1000), otherDeductionsMinor: R(1500) })).toBe(0n);
    expect(d.tdsCapForMonthMinor({ grossMinor: R(1000), otherDeductionsMinor: R(1000) })).toBe(0n);
  });
  it("effective share: the tenant setting only when the wage-law cap applies, else 100%", () => {
    expect(d.DEFAULT_MAX_DEDUCTION_SHARE_BPS).toBe(5000);
    expect(d.effectiveDeductionShareBps({ maxDeductionShareBps: 5000, deductionCapApplies: true })).toBe(5000);
    expect(d.effectiveDeductionShareBps({ maxDeductionShareBps: 5000, deductionCapApplies: false })).toBe(10000);
  });
});

describe("computeSlip: recovery lines are trimmed to the deduction-share ceiling", () => {
  // Basic 20,000, DA 0, class X HRA 24% = 4,800: gross 24,800. No pension, PF or ESI; the new-regime taxable
  // 24,800 x 12 - 75,000 = 2,22,600 is under Rs 4 lakh, so no TDS: the only deductions are the recovery lines.
  const base = { basicMinor: R(20000), daRateBps: 0n, cityClass: "X", pensionScheme: "NONE", statutoryPf: false, statutoryEsi: false, taxRegime: "new", fyStartYear: 2026 };
  const line = (code: string, rupees: number) => ({ code, name: code, type: "deduction", amountMinor: R(rupees) });
  const amountOf = (s: { deductions: Array<{ code: string; amountMinor: bigint }> }, code: string) => s.deductions.find((x) => x.code === code)?.amountMinor;

  it("with no ceiling (default 100%) the whole EMI is taken", () => {
    const s = d.computeSlip({ ...base, components: [line("LOAN_EMI", 15000)] });
    expect(s.grossMinor).toBe(R(24800));
    expect(amountOf(s, "LOAN_EMI")).toBe(R(15000));
    expect(s.recoveryCarryForwardMinor).toBe(0n);
    expect(s.totalDeductionsMinor).toBe(R(15000));
  });
  it("a 50% ceiling (12,400) cuts the EMI of 15,000 to 12,400 and carries 2,600 forward", () => {
    const s = d.computeSlip({ ...base, maxDeductionShareBps: 5000, components: [line("LOAN_EMI", 15000)] });
    expect(amountOf(s, "LOAN_EMI")).toBe(R(12400));
    expect(s.recoveryCarryForwardMinor).toBe(R(2600));
    expect(s.totalDeductionsMinor).toBe(R(12400));
    expect(s.netPayMinor).toBe(R(12400));
  });
  it("a recovery that fits inside the ceiling is untouched", () => {
    const s = d.computeSlip({ ...base, maxDeductionShareBps: 5000, components: [line("LOAN_EMI", 12400)] });
    expect(amountOf(s, "LOAN_EMI")).toBe(R(12400));
    expect(s.recoveryCarryForwardMinor).toBe(0n);
  });
  it("two recovery lines: the excess 2,600 comes off the largest first (EMI 8,000 -> 5,400); the other stays 7,000", () => {
    const s = d.computeSlip({ ...base, maxDeductionShareBps: 5000, components: [line("LOAN_EMI", 8000), line("ARREAR_RECOVERY", 7000)] });
    expect(amountOf(s, "LOAN_EMI")).toBe(R(5400));
    expect(amountOf(s, "ARREAR_RECOVERY")).toBe(R(7000));
    expect(s.recoveryCarryForwardMinor).toBe(R(2600));
    expect(s.totalDeductionsMinor).toBe(R(12400));
  });
  it("a line trimmed to nothing is dropped: ceiling 25% (6,200), fixed deduction 6,200 leaves no room for the EMI", () => {
    const s = d.computeSlip({ ...base, maxDeductionShareBps: 2500, components: [line("FIXED_X", 6200), line("LOAN_EMI", 3000)] });
    expect(amountOf(s, "LOAN_EMI")).toBeUndefined();
    expect(amountOf(s, "FIXED_X")).toBe(R(6200));
    expect(s.recoveryCarryForwardMinor).toBe(R(3000));
  });
});

describe("TDS presumption boundary, month arithmetic and the unrecorded split", () => {
  it("the boundary is the later of go-live and the first slip month, never after the run month", () => {
    expect(d.presumptionBoundaryMonth("2026-06-15", "2026-08", "2026-10")).toBe("2026-08");
    expect(d.presumptionBoundaryMonth("2026-09-01", "2026-08", "2026-10")).toBe("2026-09");
    expect(d.presumptionBoundaryMonth(null, null, "2026-10")).toBe("2026-10");
    expect(d.presumptionBoundaryMonth(undefined, "2026-12", "2026-10")).toBe("2026-10");
    expect(d.presumptionBoundaryMonth(null, "2026-10", "2026-10")).toBe("2026-10");
    expect(d.presumptionBoundaryMonth("", "2026-07", "2026-10")).toBe("2026-07");
    expect(d.presumptionBoundaryMonth("2026-08-31", "2026-08", "2026-10")).toBe("2026-08");
  });
  it("next month rolls the year over only after December", () => {
    expect(d.nextMonthOf("2026-12")).toBe("2027-01");
    expect(d.nextMonthOf("2026-01")).toBe("2026-02");
    expect(d.nextMonthOf("2026-09")).toBe("2026-10");
    expect(d.nextMonthOf("2026-11")).toBe("2026-12");
    expect(d.nextMonthOf("2026-02")).toBe("2026-03");
  });
  it("months before the boundary are presumed, the boundary and later are gaps; an opening YTD presumes nothing", () => {
    const months = ["2026-04", "2026-05", "2026-06"];
    expect(d.splitUnrecordedMonths(months, "2026-06", false)).toEqual({ presumed: ["2026-04", "2026-05"], gaps: ["2026-06"] });
    expect(d.splitUnrecordedMonths(months, "2026-04", false)).toEqual({ presumed: [], gaps: months });
    const withYtd = d.splitUnrecordedMonths(months, "2026-06", true);
    expect(withYtd).toEqual({ presumed: [], gaps: months });
    expect(withYtd.gaps).not.toBe(months);
  });
});

describe("TDS review of a run and its acknowledgement", () => {
  const slip = (no: string, over: Record<string, unknown> = {}) => ({ employeeId: `id-${no}`, employeeNo: no, ...over });
  it("lists presumed months, excess, shortfall and deferred recovery, with what needs an acknowledgement", () => {
    const items = d.tdsReviewOf([
      slip("E1", { tdsPresumedMonths: 2 }),
      slip("E2", { tdsExcessMinor: R(500) }),
      slip("E3", { tdsShortfallMinor: R(300), tdsShortfallFinal: true }),
      slip("E4", { tdsShortfallMinor: R(300), tdsShortfallFinal: false }),
      slip("E5", { recoveryDeferredMinor: R(70) }),
    ]);
    expect(items).toEqual([
      { employeeId: "id-E1", employeeNo: "E1", kind: "presumed_months", amountMinor: 0n, presumedMonths: 2, finalMonth: false, requiresAck: true },
      { employeeId: "id-E2", employeeNo: "E2", kind: "excess", amountMinor: R(500), presumedMonths: 0, finalMonth: false, requiresAck: false },
      { employeeId: "id-E3", employeeNo: "E3", kind: "shortfall", amountMinor: R(300), presumedMonths: 0, finalMonth: true, requiresAck: true },
      { employeeId: "id-E4", employeeNo: "E4", kind: "shortfall", amountMinor: R(300), presumedMonths: 0, finalMonth: false, requiresAck: false },
      { employeeId: "id-E5", employeeNo: "E5", kind: "recovery_deferred", amountMinor: R(70), presumedMonths: 0, finalMonth: false, requiresAck: false },
    ]);
  });
  it("nothing for zero, null or missing figures, nor for an excluded slip", () => {
    expect(d.tdsReviewOf([
      slip("E1", { tdsPresumedMonths: 0, tdsExcessMinor: 0n, tdsShortfallMinor: 0n, recoveryDeferredMinor: 0n }),
      slip("E2", { tdsPresumedMonths: null, tdsExcessMinor: null, tdsShortfallMinor: null, recoveryDeferredMinor: null }),
      slip("E3"),
      slip("E4", { status: "excluded", tdsPresumedMonths: 3, tdsExcessMinor: 100n, tdsShortfallMinor: 100n, recoveryDeferredMinor: 100n }),
    ])).toEqual([]);
    // a computed slip is reviewed
    expect(d.tdsReviewOf([slip("E1", { status: "computed", tdsPresumedMonths: 1 })])).toHaveLength(1);
  });
  it("sorted by employee number, then by kind", () => {
    const items = d.tdsReviewOf([
      slip("B", { tdsExcessMinor: 100n }),
      slip("A", { tdsPresumedMonths: 1, tdsExcessMinor: 100n, recoveryDeferredMinor: 100n }),
    ]);
    expect(items.map((i: { employeeNo: string; kind: string }) => `${i.employeeNo}:${i.kind}`)).toEqual(["A:excess", "A:presumed_months", "A:recovery_deferred", "B:excess"]);
  });
  it("unacknowledged = needs an ack and has no non-blank reasoned acknowledgement for the employee", () => {
    const items = d.tdsReviewOf([slip("E1", { tdsPresumedMonths: 1 }), slip("E2", { tdsPresumedMonths: 1 }), slip("E3", { tdsExcessMinor: 100n })]);
    expect(d.unacknowledgedTds(items).map((i: { employeeNo: string }) => i.employeeNo)).toEqual(["E1", "E2"]);
    expect(d.unacknowledgedTds(items, [{ employeeId: "id-E1", reason: "checked" }]).map((i: { employeeNo: string }) => i.employeeNo)).toEqual(["E2"]);
    expect(d.unacknowledgedTds(items, [{ employeeId: "id-E1", reason: "   " }]).map((i: { employeeNo: string }) => i.employeeNo)).toEqual(["E1", "E2"]);
    expect(d.unacknowledgedTds([])).toEqual([]);
  });
  it("the refusal code is the presumed-months one when any is presumed, else the shortfall one", () => {
    const presumed = d.tdsReviewOf([slip("E1", { tdsPresumedMonths: 1 })]);
    const shortfall = d.tdsReviewOf([slip("E1", { tdsShortfallMinor: 100n, tdsShortfallFinal: true })]);
    expect(d.UNRECORDED_FY_MONTHS_ESTIMATED).toBe("UNRECORDED_FY_MONTHS_ESTIMATED");
    expect(d.TDS_SHORTFALL_UNRECOVERABLE).toBe("TDS_SHORTFALL_UNRECOVERABLE");
    expect(d.unacknowledgedTdsCode(presumed)).toBe("UNRECORDED_FY_MONTHS_ESTIMATED");
    expect(d.unacknowledgedTdsCode([...shortfall, ...presumed])).toBe("UNRECORDED_FY_MONTHS_ESTIMATED");
    expect(d.unacknowledgedTdsCode(shortfall)).toBe("TDS_SHORTFALL_UNRECOVERABLE");
  });
  it("item texts name the employee and the whole-rupee amount", () => {
    const item = (kind: string, extra: Record<string, unknown> = {}) => ({ employeeId: "x", employeeNo: "E9", kind, amountMinor: R(1234), presumedMonths: 3, finalMonth: false, requiresAck: true, ...extra });
    expect(d.tdsReviewText(item("excess"))).toContain("E9: TDS deducted this FY exceeds the estimated liability by Rs 1234;");
    expect(d.tdsReviewText(item("recovery_deferred"))).toBe("E9: Rs 1234 of loan / arrear recovery is deferred to keep total deductions within the limit");
    expect(d.tdsReviewText(item("presumed_months"))).toContain("E9: 3 earlier FY month(s) have no slip and no opening YTD");
    const final = d.tdsReviewText(item("shortfall", { finalMonth: true }));
    expect(final).toContain("E9: Rs 1234 of TDS cannot be deducted within the deduction limit");
    expect(final).toContain("cannot be recovered through payroll this FY");
    const interim = d.tdsReviewText(item("shortfall", { finalMonth: false }));
    expect(interim).toContain("E9: Rs 1234 of TDS is not deducted this month");
    expect(interim).toContain("true-up recomputes it");
    expect(interim).not.toContain("cannot be recovered");
  });
  it("the approval message counts the items, shows at most 10 and says how to acknowledge", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ employeeId: `i${i}`, employeeNo: `N${String(i).padStart(2, "0")}`, kind: "excess", amountMinor: R(10), presumedMonths: 0, finalMonth: false, requiresAck: false }));
    const msg = d.unacknowledgedTdsMessage(many);
    expect(msg.startsWith("12 TDS item(s) need an acknowledgement before approval: N00:")).toBe(true);
    expect(msg).toContain("N09:");
    expect(msg).not.toContain("N10:");
    expect(msg).toContain("; ...");
    expect(msg.endsWith("Approve with tdsAcknowledgements [{ employeeId, reason }] for each employee")).toBe(true);
    const few = d.unacknowledgedTdsMessage(many.slice(0, 10));
    expect(few).not.toContain("; ...");
    expect(few.startsWith("10 TDS item(s)")).toBe(true);
  });
});

describe("net-pay approval guard: a slip that pays nothing", () => {
  const sl = (id: string, over: Record<string, unknown> = {}) => ({ employeeId: id, employeeNo: id.toUpperCase(), basicMinor: R(20000), grossMinor: R(30000), totalDeductionsMinor: R(10000), netPayMinor: R(20000), ...over });
  it("lists net <= 0 and deductions above gross; not a paying slip, an excluded slip or a zero-basic slip", () => {
    const slips = [
      sl("a"),
      sl("b", { netPayMinor: 0n }),
      sl("c", { netPayMinor: -R(10) }),
      sl("d", { totalDeductionsMinor: R(30001), netPayMinor: R(1) }),
      sl("e", { totalDeductionsMinor: R(30000), netPayMinor: R(1) }),
      sl("f", { netPayMinor: 0n, status: "excluded" }),
      sl("g", { netPayMinor: 0n, basicMinor: 0n }),
      sl("h", { netPayMinor: 0n, basicMinor: 0n, components: [{ code: "SUBSISTENCE_ALLOWANCE" }] }),
    ];
    expect(d.nonPositiveNetSlipsOf(slips).map((x: { employeeId: string }) => x.employeeId)).toEqual(["b", "c", "d", "h"]);
  });
  it("unacknowledged: those without a non-blank reasoned acknowledgement", () => {
    const slips = [sl("b"), sl("c")];
    expect(d.unacknowledgedNonPositiveNet(slips).map((x: { employeeId: string }) => x.employeeId)).toEqual(["b", "c"]);
    expect(d.unacknowledgedNonPositiveNet(slips, [{ employeeId: "b", reason: "refund via ITR" }]).map((x: { employeeId: string }) => x.employeeId)).toEqual(["c"]);
    expect(d.unacknowledgedNonPositiveNet(slips, [{ employeeId: "b", reason: " \t" }]).map((x: { employeeId: string }) => x.employeeId)).toEqual(["b", "c"]);
  });
  it("the message counts the slips, gives whole-rupee gross / deductions / net and shows at most 20", () => {
    const one = d.nonPositiveNetMessage([{ employeeNo: "TP-EMP-01", grossMinor: R(23142.8), totalDeductionsMinor: R(29029.7), netPayMinor: 0n }]);
    expect(one).toContain("1 slip(s) in this run pay nothing");
    expect(one).toContain("TP-EMP-01 (gross Rs 23142, deductions Rs 29029, net Rs 0)");
    expect(one).toContain("netPayAcknowledgements [{ employeeId, reason }]");
    expect(one).not.toContain(", ...");
    const many = Array.from({ length: 21 }, (_, i) => ({ employeeNo: `M${String(i).padStart(2, "0")}`, grossMinor: R(1), totalDeductionsMinor: R(2), netPayMinor: 0n }));
    const msg = d.nonPositiveNetMessage(many);
    expect(msg).toContain("21 slip(s)");
    expect(msg).toContain("M19 (");
    expect(msg).not.toContain("M20 (");
    expect(msg).toContain(", ...");
    expect(d.nonPositiveNetMessage(many.slice(0, 20))).not.toContain(", ...");
    expect(d.NET_PAY_NON_POSITIVE).toBe("NET_PAY_NON_POSITIVE");
  });
});

describe("run lifecycle (bundle 16 #2454): which action is allowed in which status", () => {
  const code = (a: string, s: string, stuck?: unknown) => d.runActionDenial(a, s, stuck)?.code ?? null;
  it("approve only from computed; approved / disbursed are 'already'; the rest are not ready", () => {
    expect(code("approve", "computed")).toBeNull();
    expect(code("approve", "approved")).toBe("RUN_ALREADY_APPROVED");
    expect(code("approve", "disbursed")).toBe("RUN_ALREADY_APPROVED");
    expect(code("approve", "processing")).toBe("RUN_NOT_READY_FOR_APPROVAL");
    for (const s of ["draft", "failed"]) expect(code("approve", s)).toBe("RUN_NOT_READY_FOR_APPROVAL");
    expect(d.runActionDenial("approve", "processing").message).toBe("this payroll run is still being computed; it can be approved once its status is computed");
    expect(d.runActionDenial("approve", "draft").message).toBe("a payroll run can only be approved once it is computed (current status: draft)");
    expect(d.runActionDenial("approve", "approved").message).toBe("this payroll run is already approved");
  });
  it("disburse only from approved", () => {
    expect(code("disburse", "approved")).toBeNull();
    expect(code("disburse", "disbursed")).toBe("RUN_ALREADY_DISBURSED");
    for (const s of ["draft", "processing", "computed", "failed"]) expect(code("disburse", s)).toBe("RUN_NOT_READY_FOR_DISBURSEMENT");
    expect(d.runActionDenial("disburse", "computed").message).toBe("a payroll run can only be disbursed after it is approved (current status: computed)");
    expect(d.runActionDenial("disburse", "disbursed").message).toBe("this payroll run is already disbursed");
  });
  it("revert only from failed; reject (send back) only from computed", () => {
    expect(code("revert", "failed")).toBeNull();
    for (const s of ["draft", "processing", "computed", "approved", "disbursed"]) expect(code("revert", s)).toBe("RUN_NOT_REVERTIBLE");
    expect(d.runActionDenial("revert", "approved").message).toBe("only a failed payroll run can be reverted to draft (current status: approved)");
    expect(code("reject", "computed")).toBeNull();
    for (const s of ["draft", "processing", "approved", "disbursed", "failed"]) expect(code("reject", s)).toBe("RUN_NOT_REJECTABLE");
    expect(d.runActionDenial("reject", "approved").message).toBe("only a computed payroll run can be sent back (current status: approved)");
  });
  it("failStuck: only a processing run, only after the idle threshold", () => {
    const now = new Date("2026-11-05T12:00:00Z");
    const stuck = (hoursAgo: number, hours = 6) => ({ updatedAt: new Date(now.getTime() - hoursAgo * 3_600_000), now, hours });
    for (const s of ["draft", "computed", "approved", "disbursed", "failed"]) expect(code("failStuck", s, stuck(10))).toBe("RUN_NOT_PROCESSING");
    expect(d.runActionDenial("failStuck", "computed", stuck(10)).message).toBe("only a payroll run stuck in processing can be marked failed (current status: computed)");
    expect(code("failStuck", "processing")).toBe("RUN_NOT_STUCK");
    expect(d.runActionDenial("failStuck", "processing").message).toBe("the run has no last-update time to judge whether it is stuck");
    expect(code("failStuck", "processing", stuck(5.99))).toBe("RUN_NOT_STUCK");
    expect(d.runActionDenial("failStuck", "processing", stuck(5.99)).message).toBe("this payroll run may still be computing: it was last updated less than 6 hour(s) ago");
    expect(code("failStuck", "processing", stuck(6))).toBeNull();
    expect(code("failStuck", "processing", stuck(30))).toBeNull();
    expect(code("failStuck", "processing", stuck(2, 1))).toBeNull();
  });
  it("stuck threshold: PAYROLL_STUCK_RUN_HOURS when a positive number, else 6", () => {
    expect(d.DEFAULT_STUCK_RUN_HOURS).toBe(6);
    expect(d.stuckRunHours({})).toBe(6);
    expect(d.stuckRunHours({ PAYROLL_STUCK_RUN_HOURS: "12" })).toBe(12);
    expect(d.stuckRunHours({ PAYROLL_STUCK_RUN_HOURS: "1.5" })).toBe(1.5);
    for (const bad of ["0", "-3", "abc", "", "Infinity", "NaN"]) expect(d.stuckRunHours({ PAYROLL_STUCK_RUN_HOURS: bad })).toBe(6);
  });
  it("a computation pass is accepted only into processing or computed", () => {
    expect(d.runAcceptsComputation("processing")).toBe(true);
    expect(d.runAcceptsComputation("computed")).toBe(true);
    for (const s of ["draft", "approved", "disbursed", "failed"]) expect(d.runAcceptsComputation(s)).toBe(false);
  });
  it("status transitions: the table, and a DomainError for anything else", () => {
    expect(d.RUN_TRANSITIONS).toEqual({
      draft: ["processing"], processing: ["computed", "failed"], computed: ["approved", "failed"],
      approved: ["disbursed"], disbursed: [], failed: ["draft"],
    });
    expect(() => d.assertRunStatusTransition("computed", "approved")).not.toThrow();
    expect(() => d.assertRunStatusTransition("processing", "approved")).toThrow(/INVALID_STATUS_TRANSITION.*cannot move payroll run from 'processing' to 'approved'/);
    expect(() => d.assertRunStatusTransition("approved", "failed")).toThrow(/INVALID_STATUS_TRANSITION/);
    expect(() => d.assertRunStatusTransition("nonsense", "draft")).toThrow(/INVALID_STATUS_TRANSITION/);
    try { d.assertRunStatusTransition("disbursed", "draft"); } catch (e) { expect((e as { code: string }).code).toBe("INVALID_STATUS_TRANSITION"); }
  });
});
