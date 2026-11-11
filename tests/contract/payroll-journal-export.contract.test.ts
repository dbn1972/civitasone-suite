/**
 * M9 -- payroll without Finance. The journal an export-mode tenant downloads
 * must be the SAME lines finance-service would have posted for that run, so a
 * tenant that later buys Finance (or an accountant keying the CSV into Tally)
 * ends with the books finance would have produced. Both builders are fed the
 * same run figures and compared line by line.
 */
import { describe, it, expect } from "vitest";
import { accrualJournalLines, settlementJournalLines, voucherNo, payMonthEndDate } from "../../services/payroll-service/src/modules/ledger-export/journal.js";
import { payrollAccrualLines, payrollAccrualVoucherNo, payMonthEndDate as financeMonthEnd } from "../../services/finance-service/src/modules/integrations/payroll-accrual.js";
import { runApprovedPayload } from "../../services/payroll-service/src/modules/payroll/run-approved-payload.js";

const shape = (ls: Array<{ accountCode: string; debitMinor: bigint; creditMinor: bigint; narration: string }>) =>
  ls.map((l) => [l.accountCode, l.debitMinor.toString(), l.creditMinor.toString(), l.narration]);

const runId = "11111111-1111-4111-8111-111111111111";
const base = { totalGrossMinor: 21_375_600n, totalNetMinor: 20_295_600n, totalEmployerContribMinor: 1_080_000n, edliMinor: 45_000n, epfAdminMinor: 45_000n, upsPoolMinor: 671_500n };

function financeLines(deductions?: Record<string, bigint>) {
  const payload = runApprovedPayload({ runId, month: "2027-02", ...base, ...(deductions ? { employeeDeductionsMinor: deductions } : {}) });
  return payrollAccrualLines(JSON.parse(JSON.stringify(payload)));
}

describe("payroll journal export == finance accrual lines", () => {
  it("without a deduction split", () => {
    expect(shape(accrualJournalLines(base, {}))).toEqual(shape(financeLines()));
  });
  it("with a deduction split that adds up", () => {
    const d = { tds: 500_000n, gpf: 300_000n, nps: 100_000n, pf: 100_000n, esi: 0n, pt: 20_000n, other: 60_000n };
    expect(Object.values(d).reduce((a, b) => a + b, 0n)).toBe(base.totalGrossMinor - base.totalNetMinor);
    expect(shape(accrualJournalLines({ ...base, employeeDeductionsMinor: d }, {}))).toEqual(shape(financeLines(d)));
  });
  it("with a split that does not add up (falls back to one 2102 leg in both)", () => {
    const d = { tds: 1n };
    expect(shape(accrualJournalLines({ ...base, employeeDeductionsMinor: d }, {}))).toEqual(shape(financeLines(d)));
  });
  it("a negative 'other' part is booked on the debit side in both", () => {
    const d = { tds: 1_200_000n, other: -120_000n };
    expect(shape(accrualJournalLines({ ...base, employeeDeductionsMinor: d }, {}))).toEqual(shape(financeLines(d)));
  });
  it("zero employer charges add no lines in both", () => {
    const z = { ...base, totalEmployerContribMinor: 0n, edliMinor: 0n, epfAdminMinor: 0n, upsPoolMinor: 0n };
    const payload = JSON.parse(JSON.stringify(runApprovedPayload({ runId, month: "2027-02", ...z })));
    expect(shape(accrualJournalLines(z, {}))).toEqual(shape(payrollAccrualLines(payload)));
  });
  it("the voucher number and the pay-month-end posting date are finance's", () => {
    expect(voucherNo("accrual", { id: runId, month: "2027-02" })).toBe(payrollAccrualVoucherNo({ runId, month: "2027-02" }));
    for (const m of ["2027-01", "2027-02", "2028-02", "2026-12"]) expect(payMonthEndDate(m)).toBe(financeMonthEnd(m));
  });
  it("the settlement is the net payable cleared against the bank, as finance's disbursal handler posts it", () => {
    expect(shape(settlementJournalLines(20_295_600n, {})).map((r) => r.slice(0, 3))).toEqual([["2101", "20295600", "0"], ["1101", "0", "20295600"]]);
  });
});
