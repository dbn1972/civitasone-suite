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
import { computeSlip, s192MonthlyTds, tdsCapForMonthMinor, nonPositiveNetSlipsOf, unacknowledgedNonPositiveNet, nonPositiveNetMessage, DEFAULT_MAX_DEDUCTION_SHARE_BPS, type SlipInput } from "../src/modules/payroll/domain.js";
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
    expect(jan.tdsLiabilityMinor).toBe(ANNUAL_TAX - (ANNUAL_TAX * 9n + 6n) / 12n);
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
    expect(mar.tdsMinor).toBe(tdsCapForMonthMinor({ grossMinor: GROSS, otherDeductionsMinor: NPS, maxDeductionShareBps: 7500 }));
    expect(mar.totalDeductionsMinor).toBeLessThanOrEqual((GROSS * 7500n) / 10000n);
    expect(mar.netPayMinor).toBeGreaterThanOrEqual(GROSS / 4n);
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

  it("tdsCapForMonthMinor: whole rupees, never negative", () => {
    expect(tdsCapForMonthMinor({ grossMinor: 100_050n, otherDeductionsMinor: 0n })).toBe(100_000n);
    expect(tdsCapForMonthMinor({ grossMinor: R(1000), otherDeductionsMinor: R(2000) })).toBe(0n);
    expect(tdsCapForMonthMinor({ grossMinor: R(1000), otherDeductionsMinor: R(100), maxDeductionShareBps: 5000 })).toBe(R(400));
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
