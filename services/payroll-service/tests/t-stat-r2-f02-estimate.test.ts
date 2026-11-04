/**
 * T-STAT review of PR #2449, SHOULD-FIX 1 / 2 and the 87A nit (pure).
 *
 *  - A transfer-in whose earlier salary this FY is declared (Last Pay
 *    Certificate / Form 12B -> prevEmployerSalaryMinor) is not ALSO estimated
 *    for the months with no slip here: the declared figure replaces the estimate.
 *  - Months with no slip but with recorded loss of pay (the local LOP ledger)
 *    are estimated net of that LOP, not at full pay.
 *  - Pension (taxable as salary, s.17(1)(ii)) gets the same s.192 estimate:
 *    pension actually paid this FY + current pension x remaining months, and
 *    only from the month pension began when that date is known.
 *  - s.87A marginal relief exists for the new regime from FY 2023-24 only.
 */
import { describe, it, expect } from "vitest";
import { computeSlip, unrecordedFyMonthList, pensionAnnualGrossEstimateMinor, type SlipInput } from "../src/modules/payroll/domain.js";
import { computeTax, registerTaxConfig, getTaxConfig } from "../src/modules/tax/engine.js";

const R = (rupees: number): bigint => BigInt(rupees) * 100n;
const senior: SlipInput = {
  basicMinor: R(100000), daRateBps: 5800n, cityClass: "X", pensionScheme: "NPS",
  taxRegime: "new", fyStartYear: 2026, statutoryEsi: false,
};

describe("T-STAT SF1: declared previous-employer salary replaces the unrecorded-month estimate", () => {
  it("transfer-in joined this office in November, 7 earlier months declared: no double count (review probe)", () => {
    const nov = computeSlip({
      ...senior, monthsRemaining: 5, tdsYtdMinor: 0n,
      fyPaidToDate: { grossMinor: 0n, months: 0, unrecordedMonths: 7 },
      declaration: { prevEmployerSalaryMinor: R(188000 * 7) },
    });
    // 13,16,000 declared + 1,88,000 x 5 - 75,000 = 21,81,000 (the first cut gave 34,97,000).
    expect(nov.annualTaxableMinor).toBe(R(2181000));
  });

  it("without a declaration the in-service months are still estimated (go-live tenants)", () => {
    const nov = computeSlip({ ...senior, monthsRemaining: 5, tdsYtdMinor: 0n, fyPaidToDate: { grossMinor: 0n, months: 0, unrecordedMonths: 7 } });
    expect(nov.annualTaxableMinor).toBe(R(2181000));
  });

  it("recorded LOP in months with no slip reduces the estimate", () => {
    const s = computeSlip({
      ...senior, monthsRemaining: 5, tdsYtdMinor: 0n,
      fyPaidToDate: { grossMinor: 0n, months: 0, unrecordedMonths: 7, unrecordedLopMinor: R(158000) },
    });
    expect(s.annualTaxableMinor).toBe(R(2181000 - 158000));
  });

  it("unrecordedFyMonthList: in-service months with no regular slip, from the later of April and joining", () => {
    expect(unrecordedFyMonthList(2026, "2026-11", "2019-01-01", ["2026-04", "2026-05", "2026-08"]))
      .toEqual(["2026-06", "2026-07", "2026-09", "2026-10"]);
    expect(unrecordedFyMonthList(2026, "2026-11", "2026-09-15", [])).toEqual(["2026-09", "2026-10"]);
    expect(unrecordedFyMonthList(2026, "2026-04", null, [])).toEqual([]);
  });
});

describe("T-STAT SF2: pensioner TDS uses the s.192 estimate, not this month x 12", () => {
  it("pension began in October: paid Oct + Nov, December run -> paid + current x 4 months", () => {
    expect(pensionAnnualGrossEstimateMinor({
      currentGrossMinor: R(150000), fyPaid: { grossMinor: R(300000), months: 2 }, unrecordedMonths: 0, monthsRemaining: 4,
    })).toBe(R(300000 + 150000 * 4));
  });
  it("whole-year pensioner with no history in the system: unchanged (current x 12)", () => {
    expect(pensionAnnualGrossEstimateMinor({
      currentGrossMinor: R(150000), fyPaid: { grossMinor: 0n, months: 0 }, unrecordedMonths: 8, monthsRemaining: 4,
    })).toBe(R(150000 * 12));
  });
});

describe("T-STAT nit: 87A marginal relief only from FY 2023-24 for the new regime", () => {
  it("a configured FY 2022-23 new-regime row gets the plain rebate, no relief", () => {
    const tenant = "7a5e0000-0000-4000-8000-0000000f0202";
    registerTaxConfig("new", 2022, { ...getTaxConfig("new", 2024), rebateIncomeCap: 500000, rebateMax: 12500 }, tenant);
    // FY 2024 slabs: 3-7L at 5%. At 5,00,000: 10,000, rebated. At 5,10,000: 10,500 + 4% cess, no relief.
    expect(computeTax(500000, "new", 2022, tenant).totalTax).toBe(0);
    expect(computeTax(510000, "new", 2022, tenant).rebate).toBe(0);
    expect(computeTax(510000, "new", 2022, tenant).totalTax).toBe(10920);
    // FY 2024-25 keeps the relief.
    expect(computeTax(710000, "new", 2024).totalTax).toBe(10400);
  });
});
