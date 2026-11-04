/**
 * T-STAT F02 (HIGH, statutory audit 2026-11-03): monthly TDS estimated the
 * annual salary as THIS month gross x 12.
 *
 * s.192(1) requires TDS at the average rate on the income estimated for the
 * whole FY. The standard estimate (and the one the auditor recompute.py
 * uses) is:
 *
 *   salary actually paid in the FY before this month
 *   + this month regular salary x months remaining (including this one)
 *   + one-off items paid this month (arrears, bonus, reimbursements) ONCE
 *   - standard deduction (and, old regime, Chapter VI-A deductions)
 *
 * and monthly TDS = (annual tax - TDS already deducted in the FY) / months
 * remaining (the final month deducts the full balance), never below zero.
 */
import { describe, it, expect } from "vitest";
import { computeSlip, unrecordedFyMonths, type SlipInput } from "../src/modules/payroll/domain.js";
import { annualTaxFromTaxableMinor } from "../src/modules/tax/engine.js";

const R = (rupees: number): bigint => BigInt(rupees) * 100n;

/** Basic 1,00,000 + DA 58% (58,000) + HRA 30% (30,000) = 1,88,000 regular gross, NPS. */
const senior: SlipInput = {
  basicMinor: R(100000), daRateBps: 5800n, cityClass: "X", pensionScheme: "NPS",
  taxRegime: "new", fyStartYear: 2026, statutoryEsi: false,
};

/** A flat Rs 94,000 regular salary (special pay, no basic/DA/HRA) -- the audit example. */
const flat94k: SlipInput = {
  basicMinor: 0n, pensionScheme: "GPF", taxRegime: "new", fyStartYear: 2026, statutoryEsi: false,
  rawComponents: [{ code: "SPL", name: "Special Pay", type: "earning", fixedMinor: R(94000) }],
};

describe("T-STAT F02: s.192 annual estimate uses salary actually paid + regular x remaining + one-offs once", () => {
  it("mid-year joiner (joined October, nothing paid earlier this FY): projects 6 months, not 12", () => {
    const s = computeSlip({ ...senior, monthsRemaining: 6, tdsYtdMinor: 0n, fyPaidToDate: { grossMinor: 0n, months: 0 } });
    expect(s.grossMinor).toBe(R(188000));
    // 1,88,000 x 6 - 75,000 = 10,53,000 -> within the Rs 12 lakh rebate -> nil tax.
    expect(s.annualTaxableMinor).toBe(R(1053000));
    expect(s.tdsMinor).toBe(0n);
    // The old x12 estimate (21,81,000 taxable) would have deducted tax from a joiner who owes none.
    const legacy = computeSlip({ ...senior, monthsRemaining: 6, tdsYtdMinor: 0n });
    expect(legacy.tdsMinor).toBeGreaterThan(0n);
  });

  it("arrears month: the audit example (Rs 94,000/month + Rs 33,521 arrears in March) owes nothing", () => {
    const march = computeSlip({
      ...flat94k, monthsRemaining: 1, tdsYtdMinor: 0n,
      fyPaidToDate: { grossMinor: R(94000 * 11), months: 11 },
      components: [{ code: "ARREAR", name: "Arrears", type: "earning", amountMinor: R(33521) }],
    });
    expect(march.grossMinor).toBe(R(94000 + 33521));
    // 10,34,000 paid + 94,000 x 1 + 33,521 once - 75,000 = 10,86,521 (was 14,55,252 = 1,27,521 x 12 - 75,000).
    expect(march.annualTaxableMinor).toBe(R(1086521));
    expect(march.tdsMinor).toBe(0n); // the old engine deducted Rs 1,02,220
  });

  it("arrears are counted once, not x remaining months, for a taxpayer above the rebate limit", () => {
    const dec = computeSlip({
      ...senior, monthsRemaining: 4, tdsYtdMinor: R(150000),
      fyPaidToDate: { grossMinor: R(188000 * 8), months: 8 },
      components: [
        { code: "ARREAR", name: "Arrears", type: "earning", amountMinor: R(40000) },
        { code: "BONUS", name: "Bonus", type: "earning", amountMinor: R(10000) },
      ],
    });
    // 15,04,000 + 1,88,000 x 4 + 50,000 - 75,000 = 21,81,000 + 50,000 = 22,31,000
    expect(dec.annualTaxableMinor).toBe(R(2231000));
    const annualTax = annualTaxFromTaxableMinor(R(2231000), "new", 2026);
    expect(dec.tdsMinor).toBe(((annualTax - R(150000)) / 4n + 50n) / 100n * 100n);
  });

  it("earlier over-deduction: later months reduce, and never go negative", () => {
    // Annual estimate on 1,88,000 x 12: taxable 21,81,000.
    const annualTax = annualTaxFromTaxableMinor(R(2181000), "new", 2026);
    const fyPaid = { grossMinor: R(188000 * 8), months: 8 };
    const normal = computeSlip({ ...senior, monthsRemaining: 4, tdsYtdMinor: annualTax * 8n / 12n, fyPaidToDate: fyPaid });
    const over = computeSlip({ ...senior, monthsRemaining: 4, tdsYtdMinor: annualTax * 10n / 12n, fyPaidToDate: fyPaid });
    expect(over.tdsMinor).toBeLessThan(normal.tdsMinor);
    expect(over.tdsMinor).toBeGreaterThan(0n);
    const wayOver = computeSlip({ ...senior, monthsRemaining: 4, tdsYtdMinor: annualTax + R(5000), fyPaidToDate: fyPaid });
    expect(wayOver.tdsMinor).toBe(0n);
  });

  it("March final month: the whole residual balance is trued up", () => {
    const annualTax = annualTaxFromTaxableMinor(R(2181000), "new", 2026);
    const march = computeSlip({
      ...senior, monthsRemaining: 1, tdsYtdMinor: annualTax - R(12345),
      fyPaidToDate: { grossMinor: R(188000 * 11), months: 11 },
    });
    expect(march.annualTaxableMinor).toBe(R(2181000));
    expect(march.tdsMinor).toBe(R(12345));
  });

  it("salary actually paid drives the estimate (a pay rise mid-year is not back-projected)", () => {
    // Paid 1,00,000 for 9 months; now 1,88,000 for the last 3.
    const jan = computeSlip({ ...senior, monthsRemaining: 3, tdsYtdMinor: 0n, fyPaidToDate: { grossMinor: R(900000), months: 9 } });
    expect(jan.annualTaxableMinor).toBe(R(900000 + 188000 * 3 - 75000));
  });

  it("current-month LOP reduces the salary actually paid this month", () => {
    const s = computeSlip({
      ...senior, monthsRemaining: 6, tdsYtdMinor: 0n, fyPaidToDate: { grossMinor: R(1128000), months: 6 },
      components: [{ code: "LOP", name: "Loss of Pay", type: "deduction", amountMinor: R(10000) }],
    });
    expect(s.annualTaxableMinor).toBe(R(1128000 + 188000 * 6 - 10000 - 75000));
  });

  it("no FY history supplied (preview callers): regular x 12, one-offs still counted once", () => {
    const s = computeSlip({
      ...senior, components: [{ code: "ARREAR", name: "Arrears", type: "earning", amountMinor: R(40000) }],
    });
    expect(s.annualTaxableMinor).toBe(R(188000 * 12 + 40000 - 75000));
  });
});

describe("T-STAT F02: months in service with no slip in this system are estimated, joiners are not", () => {
  it("unrecordedFyMonths: in service all year (no / earlier DOJ) vs joined mid-year", () => {
    // March 2027 run, FY 2026-27: April..February = 11 earlier months.
    expect(unrecordedFyMonths(2026, "2027-03", "2019-06-01", 2)).toBe(9); // only Dec + Jan in the system
    expect(unrecordedFyMonths(2026, "2027-03", null, 11)).toBe(0);
    expect(unrecordedFyMonths(2026, "2026-10", "2026-10-15", 0)).toBe(0); // joined this month
    expect(unrecordedFyMonths(2026, "2026-12", "2026-10-15", 1)).toBe(1); // Oct + Nov in service, Nov only recorded
    expect(unrecordedFyMonths(2026, "2026-04", "2015-01-01", 0)).toBe(0); // April: nothing earlier
  });

  it("UATG1-34285 March: only Dec + Jan slips in the system -> the other 9 months are estimated at the regular salary, arrears once", () => {
    // Regular 58,092 (30,900 + DA 17,922 + HRA 9,270); paid Dec 62,040 + Jan 58,092 (gross) in the system.
    const s = computeSlip({
      basicMinor: R(30900), daRateBps: 5800n, cityClass: "X", pensionScheme: "NPS", taxRegime: "new", fyStartYear: 2026,
      statutoryEsi: false, monthsRemaining: 1, tdsYtdMinor: 0n,
      fyPaidToDate: { grossMinor: R(62040 + 58092), months: 2, unrecordedMonths: 9 },
      components: [
        { code: "ARREAR", name: "Arrears", type: "earning", amountMinor: R(27560) },
        { code: "REIMB", name: "Reimbursement", type: "earning", amountMinor: R(5961) },
      ],
    });
    // 1,20,132 + 58,092 x 9 + 58,092 + 33,521 - 75,000 = 6,59,573 (stored on the slip was 10,24,356 = 91,613 x 12 - 75,000)
    expect(s.annualTaxableMinor).toBe(R(120132 + 58092 * 10 + 33521 - 75000));
    expect(s.tdsMinor).toBe(0n);
  });
});
