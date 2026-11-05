/**
 * UAT T-PERIOD D-02b (2026-11-04, CRITICAL): the March 2027 s.192 true-up took
 * TDS Rs 2,70,847 from TP-EMP-01 on a gross of Rs 2,31,428 (net Rs 0, slip
 * "exception"), while the tax on the salary actually paid was nil; Form 16
 * then showed a refund of Rs 4,06,270. The run was approved and disbursed with
 * no warning.
 *
 * Root cause (domain.ts computeSlip, #2449 T-STAT F02 / SF1): the employee is
 * in service since 2020 but only Jan and Mar 2027 have slips here, so the 10
 * other FY months are estimated at the regular pay (annual gross 12 x
 * 2,31,428 -> tax Rs 4,06,270), yet the TDS for those 10 months was taken as
 * zero. The whole-year tax was squeezed into the months recorded here: January
 * 4,06,270 / 3 = 1,35,423, March 4,06,270 - 1,35,423 = 2,70,847. Nothing capped
 * TDS at the salary of the month.
 *
 * Fixed: the TDS for presumed months is presumed at the average monthly rate
 * (liability here = annual tax x months here / FY months); monthly TDS =
 * max(0, (liability - deducted so far) / months remaining), the whole balance
 * in March; deducted above the liability -> 0 TDS + tdsExcessMinor; TDS never
 * exceeds the month salary left after the other deductions / the configured
 * deduction share.
 */
import { describe, it, expect } from "vitest";
import {
  computeSlip, s192MonthlyTds, tdsCapForMonthMinor, nonPositiveNetSlipsOf, unacknowledgedNonPositiveNet, nonPositiveNetMessage, DEFAULT_MAX_DEDUCTION_SHARE_BPS, type SlipInput,
  presumptionBoundaryMonth, splitUnrecordedMonths, tdsReviewOf, unacknowledgedTds, unacknowledgedTdsCode, tdsReviewText, effectiveDeductionShareBps,
} from "../src/modules/payroll/domain.js";
import { annualTaxFromTaxableMinor } from "../src/modules/tax/engine.js";

const R = (rupees: number): bigint => BigInt(rupees) * 100n;

// TP-EMP-01 (T-PERIOD seed): Level 13, basic 1,23,100, DA 58%, HRA X (30%), NPS, new regime.
// Monthly gross 1,23,100 + 71,398 + 36,930 = 2,31,428; NPS employee 10% of Basic + DA = 19,450.
const tpEmp01: SlipInput = {
  basicMinor: R(123100), daRateBps: 5800n, cityClass: "X", pensionScheme: "NPS",
  taxRegime: "new", fyStartYear: 2026, statutoryEsi: false,
};
const GROSS = R(231428);
const NPS = R(19450);
// The FY estimate: 12 x 2,31,428 - 75,000 standard deduction.
const ANNUAL_TAX = annualTaxFromTaxableMinor(R(231428 * 12 - 75000), "new", 2026);

describe("T-PERIOD D-02b: the exact T-PERIOD case (TP-EMP-01, FY 2026-27)", () => {
  it("the estimate is the whole FY at the regular pay: tax about Rs 4,06,270", () => {
    expect(ANNUAL_TAX).toBeGreaterThan(R(406000));
    expect(ANNUAL_TAX).toBeLessThan(R(406500));
  });

  it("root cause: without the presumed TDS of the 10 months with no slip, March takes the whole balance (Rs 2,70,847 > gross)", () => {
    const old = s192MonthlyTds({ annualTaxMinor: ANNUAL_TAX, tdsDeductedMinor: R(135423), monthsRemaining: 1 });
    expect(old.tdsMinor).toBeGreaterThan(GROSS);
    expect(old.tdsMinor / 100n).toBeGreaterThan(270800n);
  });

  it("January (first slip here, 9 earlier months presumed): about Rs 33,856 instead of Rs 1,35,423", () => {
    const jan = computeSlip({ ...tpEmp01, monthsRemaining: 3, tdsYtdMinor: 0n, fyPaidToDate: { grossMinor: 0n, months: 0, unrecordedMonths: 9 } });
    expect(jan.grossMinor).toBe(GROSS);
    // liability for the 3 months here = annual tax x 3 / 12, spread over 3 months.
    // (the presumed share rounded to the rupee, s.288B -- PR #2459 review SF2)
    expect(jan.tdsLiabilityMinor).toBe(ANNUAL_TAX - (((ANNUAL_TAX * 9n + 6n) / 12n + 50n) / 100n) * 100n);
    expect(jan.tdsMinor / 100n).toBeGreaterThanOrEqual(33850n);
    expect(jan.tdsMinor / 100n).toBeLessThanOrEqual(33860n);
    expect(jan.tdsExcessMinor).toBe(0n);
  });

  it("March, with the Rs 1,35,423 already deducted in January: TDS 0, the excess is reported, the employee is paid", () => {
    const mar = computeSlip({
      ...tpEmp01, monthsRemaining: 1, tdsYtdMinor: R(135423),
      fyPaidToDate: { grossMinor: GROSS, months: 1, unrecordedMonths: 10 },
    });
    expect(mar.grossMinor).toBe(GROSS);
    expect(mar.tdsMinor).toBe(0n);
    expect(mar.tdsExcessMinor).toBe(R(135423) - mar.tdsLiabilityMinor);
    expect(mar.tdsExcessMinor / 100n).toBeGreaterThan(67000n);
    expect(mar.netPayMinor).toBe(GROSS - NPS);
    expect(mar.negativeNet).toBe(false);
    expect(mar.deductions.find((d) => d.code === "TDS")).toBeUndefined();
  });
});

describe("T-PERIOD D-02b: s.192 rules", () => {
  it("zero liability: no TDS, no excess; with TDS already deducted the whole of it is excess", () => {
    const low: SlipInput = { basicMinor: R(30000), daRateBps: 5800n, cityClass: "Y", pensionScheme: "NPS", taxRegime: "new", fyStartYear: 2026, statutoryEsi: false };
    const none = computeSlip({ ...low, monthsRemaining: 6, tdsYtdMinor: 0n, fyPaidToDate: { grossMinor: R(50000 * 6), months: 6 } });
    expect(none.tdsMinor).toBe(0n);
    expect(none.tdsLiabilityMinor).toBe(0n);
    expect(none.tdsExcessMinor).toBe(0n);
    const over = computeSlip({ ...low, monthsRemaining: 6, tdsYtdMinor: R(5000), fyPaidToDate: { grossMinor: R(50000 * 6), months: 6 } });
    expect(over.tdsMinor).toBe(0n);
    expect(over.tdsExcessMinor).toBe(R(5000));
  });

  it("over-deducted in earlier months (all months recorded): TDS 0 for the rest of the year, never negative", () => {
    const s = computeSlip({ ...tpEmp01, monthsRemaining: 6, tdsYtdMinor: R(450000), fyPaidToDate: { grossMinor: GROSS * 6n, months: 6 } });
    expect(s.tdsLiabilityMinor).toBe(ANNUAL_TAX);
    expect(s.tdsMinor).toBe(0n);
    expect(s.tdsExcessMinor).toBe(R(450000) - ANNUAL_TAX);
    expect(s.netPayMinor).toBe(GROSS - NPS);
  });

  it("on track: (liability - deducted) / months remaining", () => {
    const s = computeSlip({ ...tpEmp01, monthsRemaining: 4, tdsYtdMinor: R(200000), fyPaidToDate: { grossMinor: GROSS * 8n, months: 8 } });
    const expected = s192MonthlyTds({ annualTaxMinor: ANNUAL_TAX, tdsDeductedMinor: R(200000), monthsRemaining: 4 }).tdsMinor;
    expect(s.tdsMinor).toBe(expected);
    expect(s.tdsMinor * 4n - (ANNUAL_TAX - R(200000))).toBeLessThanOrEqual(R(2));
  });

  it("March true-up (11 months recorded, under-deducted): the whole balance, exactly", () => {
    const deducted = ANNUAL_TAX - R(25000);
    const mar = computeSlip({ ...tpEmp01, monthsRemaining: 1, tdsYtdMinor: deducted, fyPaidToDate: { grossMinor: GROSS * 11n, months: 11 } });
    expect(mar.tdsMinor).toBe(R(25000));
    expect(mar.tdsExcessMinor).toBe(0n);
    expect(mar.tdsShortfallMinor).toBe(0n);
  });

  it("March true-up larger than the month salary: TDS capped at the configured share of gross, the rest reported as shortfall", () => {
    // Big earlier pay (11 x 6,00,000) and nothing deducted: the March balance far exceeds the March pay.
    const mar = computeSlip({
      ...tpEmp01, monthsRemaining: 1, tdsYtdMinor: 0n, fyPaidToDate: { grossMinor: R(600000 * 11), months: 11 },
      maxDeductionShareBps: DEFAULT_MAX_DEDUCTION_SHARE_BPS,
    });
    // PR #2459 review B3: default 50%, Code on Wages 2019 s.18(2).
    expect(DEFAULT_MAX_DEDUCTION_SHARE_BPS).toBe(5000);
    expect(mar.tdsMinor).toBe(tdsCapForMonthMinor({ grossMinor: GROSS, otherDeductionsMinor: NPS, maxDeductionShareBps: 5000 }));
    expect(mar.totalDeductionsMinor).toBeLessThanOrEqual(GROSS / 2n);
    expect(mar.netPayMinor).toBeGreaterThanOrEqual(GROSS / 2n);
    expect(mar.tdsShortfallMinor).toBeGreaterThan(0n);
    expect(mar.negativeNet).toBe(false);
  });

  it("TDS never exceeds the salary left after the other deductions and the protected-net floor (default share 100%)", () => {
    const mar = computeSlip({ ...tpEmp01, monthsRemaining: 1, tdsYtdMinor: 0n, fyPaidToDate: { grossMinor: R(600000 * 11), months: 11 }, protectedNetFloorMinor: R(10000) });
    expect(mar.tdsMinor).toBe(GROSS - NPS - R(10000));
    expect(mar.netPayMinor).toBe(R(10000));
  });

  it("a declared previous-employer salary replaces the presumed months; its TDS counts as deducted", () => {
    const s = s192MonthlyTds({ annualTaxMinor: R(120000), tdsDeductedMinor: R(60000), monthsRemaining: 6, presumedMonths: 0n, fyMonths: 12n });
    expect(s.liabilityMinor).toBe(R(120000));
    expect(s.tdsMinor).toBe(R(10000));
  });

  it("PR #2459 review: TDS is rounded to the nearest rupee (s.288B), the March balance included", () => {
    // a balance of Rs 33,855.67 left for the last month
    expect(s192MonthlyTds({ annualTaxMinor: 3_385_567n, tdsDeductedMinor: 0n, monthsRemaining: 1 }).tdsMinor).toBe(3_385_600n);
    expect(s192MonthlyTds({ annualTaxMinor: 3_385_549n, tdsDeductedMinor: 0n, monthsRemaining: 1 }).tdsMinor).toBe(3_385_500n);
    for (const [ytd, left, unrec] of [[0n, 1, 10], [R(135423), 1, 10], [R(1), 1, 0], [R(7), 3, 9], [R(333), 7, 2]] as const) {
      const recorded = 12 - left - unrec;
      const s = computeSlip({ ...tpEmp01, monthsRemaining: left, tdsYtdMinor: ytd + 37n, fyPaidToDate: { grossMinor: GROSS * BigInt(recorded), months: recorded, unrecordedMonths: unrec } });
      expect(s.tdsMinor % 100n).toBe(0n);
    }
  });

  it("PR #2459 review: the deduction share binds loan EMI / arrear recovery too (was 96.6% of gross); LOP is never trimmed by it", () => {
    const base: SlipInput = {
      ...tpEmp01, monthsRemaining: 6, tdsYtdMinor: R(200000), fyPaidToDate: { grossMinor: GROSS * 6n, months: 6 },
      components: [
        { code: "LOAN_EMI", name: "HBA instalment", type: "deduction", amountMinor: R(150000) },
        { code: "ARREAR_RECOVERY", name: "Recovery", type: "deduction", amountMinor: R(30000) },
      ],
    };
    const legacy = computeSlip(base); // share 100%: recoveries limited by the floor only
    expect(legacy.totalDeductionsMinor * 1000n / legacy.grossMinor).toBeGreaterThan(900n);
    const s = computeSlip({ ...base, maxDeductionShareBps: 7500 });
    expect(s.totalDeductionsMinor).toBeLessThanOrEqual((GROSS * 7500n) / 10000n);
    expect(s.netPayMinor).toBeGreaterThanOrEqual(GROSS / 4n);
    expect(s.tdsMinor).toBe(legacy.tdsMinor); // statutory deductions first
    const recovered = s.deductions.filter((d) => d.code === "LOAN_EMI" || d.code === "ARREAR_RECOVERY").reduce((a, d) => a + d.amountMinor, 0n);
    expect(recovered + s.recoveryCarryForwardMinor).toBe(R(180000));
    expect(s.totalDeductionsMinor).toBe((GROSS * 7500n) / 10000n); // the recoveries fill the ceiling exactly
    // LOP stays whole (pay not earned), the share is of the salary earned
    const withLop = computeSlip({ ...base, maxDeductionShareBps: 7500, components: [...base.components!, { code: "LOP", name: "Loss of Pay", type: "deduction", amountMinor: R(50000) }] });
    expect(withLop.deductions.find((d) => d.code === "LOP")!.amountMinor).toBe(R(50000));
    expect(withLop.totalDeductionsMinor - R(50000)).toBeLessThanOrEqual(((GROSS - R(50000)) * 7500n) / 10000n);
  });

  it("tdsCapForMonthMinor: whole rupees, never negative", () => {
    expect(tdsCapForMonthMinor({ grossMinor: 100_050n, otherDeductionsMinor: 0n })).toBe(100_000n);
    expect(tdsCapForMonthMinor({ grossMinor: R(1000), otherDeductionsMinor: R(2000) })).toBe(0n);
    expect(tdsCapForMonthMinor({ grossMinor: R(1000), otherDeductionsMinor: R(100), maxDeductionShareBps: 5000 })).toBe(R(400));
  });
});

describe("PR #2459 review B1: presumption only before go-live / the first slip here, never for gaps", () => {
  it("boundary = the later of the go-live month and the first slip month (this run when there is none)", () => {
    expect(presumptionBoundaryMonth(null, "2027-01", "2027-03")).toBe("2027-01");
    expect(presumptionBoundaryMonth(null, null, "2027-03")).toBe("2027-03");
    expect(presumptionBoundaryMonth("2026-11-01", "2026-06", "2027-03")).toBe("2026-11");
    expect(presumptionBoundaryMonth("2026-04-01", "2027-01", "2027-03")).toBe("2027-01");
  });

  it("T-PERIOD, February skipped: Apr-Dec presumed, February a gap; an opening YTD presumes nothing", () => {
    const unrecorded = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-02"];
    expect(splitUnrecordedMonths(unrecorded, "2027-01", false)).toEqual({ presumed: unrecorded.slice(0, 9), gaps: ["2027-02"] });
    expect(splitUnrecordedMonths(unrecorded, "2027-01", true)).toEqual({ presumed: [], gaps: unrecorded });
  });

  it("the March true-up spreads the liability over the 11 months paid (Feb not presumed), whole rupees", () => {
    const mar = computeSlip({ ...tpEmp01, monthsRemaining: 1, tdsYtdMinor: R(33856), fyPaidToDate: { grossMinor: GROSS, months: 1, unrecordedMonths: 9 } });
    const annual11 = annualTaxFromTaxableMinor(R(231428 * 11 - 75000), "new", 2026);
    const presumed = ((annual11 * 9n + 5n) / 11n + 50n) / 100n * 100n;
    expect(mar.tdsLiabilityMinor).toBe(annual11 - presumed);
    expect(mar.tdsMinor).toBe(((annual11 - presumed - R(33856)) + 50n) / 100n * 100n);
    expect(mar.tdsMinor % 100n).toBe(0n);
  });
});

describe("PR #2459 review B2: TDS signals for the approver", () => {
  const slip = (employeeId: string, employeeNo: string, over: Record<string, unknown>) => ({ employeeId, employeeNo, status: "computed", ...over });
  const items = tdsReviewOf([
    slip("a", "A-PRESUMED", { tdsPresumedMonths: 9 }),
    slip("b", "B-EXCESS", { tdsExcessMinor: R(67711) }),
    slip("c", "C-MARCH", { tdsShortfallMinor: R(1684209), tdsShortfallFinal: true }),
    slip("d", "D-OCT", { tdsShortfallMinor: R(5000), tdsShortfallFinal: false, recoveryDeferredMinor: R(20000) }),
    slip("x", "X-EXCLUDED", { status: "excluded", tdsPresumedMonths: 3 }),
  ]);

  it("presumed months and an unrecoverable (last month / separation) shortfall need an acknowledgement; excess and deferral are shown", () => {
    expect(items.map((i) => [i.employeeNo, i.kind, i.requiresAck])).toEqual([
      ["A-PRESUMED", "presumed_months", true], ["B-EXCESS", "excess", false], ["C-MARCH", "shortfall", true],
      ["D-OCT", "recovery_deferred", false], ["D-OCT", "shortfall", false],
    ]);
    expect(unacknowledgedTds(items).map((i) => i.employeeNo)).toEqual(["A-PRESUMED", "C-MARCH"]);
    expect(unacknowledgedTds(items, [{ employeeId: "a", reason: "Opening YTD to be entered" }]).map((i) => i.employeeNo)).toEqual(["C-MARCH"]);
    expect(unacknowledgedTdsCode(unacknowledgedTds(items))).toBe("UNRECORDED_FY_MONTHS_ESTIMATED");
    expect(unacknowledgedTdsCode(unacknowledgedTds(items, [{ employeeId: "a", reason: "Opening YTD to be entered" }]))).toBe("TDS_SHORTFALL_UNRECOVERABLE");
  });

  it("the last-month shortfall text states the truth; no promise of later collection", () => {
    const final = tdsReviewText(items.find((i) => i.employeeNo === "C-MARCH")!);
    expect(final).toContain("cannot be recovered through payroll this FY -- collect separately or adjust before Form 16");
    expect(final).not.toMatch(/following months|later months/);
    expect(tdsReviewText(items.find((i) => i.employeeNo === "B-EXCESS")!)).toMatch(/refundable/);
  });

  it("the wage-law cap can be disapplied per tenant (net-pay floor + acknowledgements then)", () => {
    expect(effectiveDeductionShareBps({ maxDeductionShareBps: 5000, deductionCapApplies: true })).toBe(5000);
    expect(effectiveDeductionShareBps({ maxDeductionShareBps: 5000, deductionCapApplies: false })).toBe(10000);
  });
});

describe("T-PERIOD D-02b: NET_PAY_NON_POSITIVE approval guard (pure)", () => {
  const slip = (employeeId: string, employeeNo: string, gross: number, ded: number, net: number, extra: Partial<{ basicMinor: bigint; status: string }> = {}) => ({
    employeeId, employeeNo, basicMinor: R(1000), grossMinor: R(gross), totalDeductionsMinor: R(ded), netPayMinor: R(net), status: "computed", components: [], ...extra,
  });
  const slips = [
    slip("e1", "TP-EMP-01", 231428, 290297, 0, { status: "exception" }),
    slip("e2", "TP-EMP-02", 84412, 7094, 77318),
    slip("e3", "FULL-LOP", 50000, 50000, 0),
    slip("e4", "ZERO-BASIC", 0, 0, 0, { basicMinor: 0n }),
    slip("e5", "EXCLUDED", 1000, 2000, 0, { status: "excluded" }),
  ];

  it("lists slips with net <= 0 or deductions above gross; Rs 0-basic and excluded slips have their own handling", () => {
    expect(nonPositiveNetSlipsOf(slips).map((s) => s.employeeNo)).toEqual(["TP-EMP-01", "FULL-LOP"]);
  });

  it("an acknowledgement needs a non-blank reason and only clears the slip it names", () => {
    const found = nonPositiveNetSlipsOf(slips);
    expect(unacknowledgedNonPositiveNet(found, [{ employeeId: "e1", reason: "  " }]).map((s) => s.employeeNo)).toEqual(["TP-EMP-01", "FULL-LOP"]);
    expect(unacknowledgedNonPositiveNet(found, [{ employeeId: "e1", reason: "TDS refund case, checked with DDO" }]).map((s) => s.employeeNo)).toEqual(["FULL-LOP"]);
  });

  it("the message names the employee, gross, deductions and net", () => {
    const msg = nonPositiveNetMessage(nonPositiveNetSlipsOf(slips));
    expect(msg).toContain("TP-EMP-01 (gross Rs 231428, deductions Rs 290297, net Rs 0)");
    expect(msg).toContain("netPayAcknowledgements");
  });
});
