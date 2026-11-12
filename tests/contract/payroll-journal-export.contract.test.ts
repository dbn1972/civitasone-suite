/**
 * M9 -- payroll without Finance. The journal an export-mode tenant downloads
 * must be the SAME lines finance-service would have posted for that run, so a
 * tenant that later buys Finance (or an accountant keying the CSV into Tally)
 * ends with the books finance would have produced. Both builders are fed the
 * same run figures and compared line by line.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { accrualJournalLines, settlementJournalLines, voucherNo, payMonthEndDate } from "../../services/payroll-service/src/modules/ledger-export/journal.js";
import { payrollAccrualLines, payrollAccrualVoucherNo, payrollSettlementEntries, payrollSettlementVoucherNo, payMonthEndDate as financeMonthEnd } from "../../services/finance-service/src/modules/integrations/payroll-accrual.js";
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
  it("the settlement is exactly the entries finance's gl consumer posts on payroll.run.disbursed (same builder, default and overridden heads)", () => {
    for (const env of [{}, { PAYROLL_GL_NET_PAYABLE_HEAD: "2150", PAYROLL_GL_BANK_HEAD: "1180" }]) {
      const mine = settlementJournalLines(20_295_600n, env).map((l) => [l.accountCode, l.debitMinor.toString(), l.creditMinor.toString()]);
      const theirs = payrollSettlementEntries(20_295_600n, env).map((e) => [e.headCode, e.debitMinor, e.creditMinor]);
      expect(mine).toEqual(theirs);
    }
    expect(settlementJournalLines(0n, {})).toEqual([]);
  });
  it("the settlement voucher number is finance's", () => {
    const run = { id: runId, month: "2027-02" };
    expect(voucherNo("disbursement", run)).toBe(payrollSettlementVoucherNo({ runId, month: "2027-02" }));
  });
  it("finance's gl consumer builds its settlement from that shared builder (no private copy left to drift)", () => {
    const src = readFileSync(join(process.cwd(), "services/finance-service/src/modules/gl/consumer.ts"), "utf8");
    expect(src).toContain("payrollSettlementEntries(net)");
    expect(src).toContain("payrollSettlementVoucherNo(p)");
    expect(src).not.toMatch(/PAYROLL_GL_NET_PAYABLE_HEAD/);
  });
});
