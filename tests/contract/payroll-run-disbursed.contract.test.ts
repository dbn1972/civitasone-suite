/**
 * UAT T-PERIOD D-04 (ERP-head decision 2026-11-05) -- producer/consumer contract
 * for the payroll GL posting DATE (payroll-service -> finance-service):
 *   cash-basis tenant    -> salary accrual + settlement dated the payment
 *                           (disbursal) date: March pay disbursed on 1 April
 *                           posts in the new FY;
 *   accrual-basis tenant -> accrual dated the last day of the pay month,
 *                           settlement on the payment date.
 * The basis is finance gl.finance_settings.accounting_basis (#2455). Payroll
 * carries the facts (pay month, IST payment date, accrual amounts) on
 * payroll.run.approved / payroll.run.disbursed; finance decides the date.
 * Backward compatible both ways: an older payroll payload (no
 * accrualCarriedOnDisbursal / paymentDate / amounts on disbursal) still posts
 * the accrual on approval; an older finance build ignores the new fields.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runApprovedPayload, runDisbursedPayload, istDateOf as payrollIstDate } from "../../services/payroll-service/src/modules/payroll/run-approved-payload.js";
import {
  payrollAccrualLines, accrualDateOnApproval, postingDatesOnDisbursal, payMonthEndDate, istDateOf, payrollAccrualJournalCommand, payrollAccrualVoucherNo,
} from "../../services/finance-service/src/modules/integrations/payroll-accrual.js";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const amounts = {
  runId: "fa3666c2-0b91-416e-a7df-79282327e941", month: "2027-03", totalGrossMinor: 42_130_800n, totalNetMinor: 17_392_200n,
  totalEmployerContribMinor: 4_957_100n, edliMinor: 0n, epfAdminMinor: 0n, upsPoolMinor: 0n, legalEntityId: null,
};
// 1 April 2027 00:30 IST = 31 March 2027 19:00 UTC.
const PAID_AT = new Date("2027-03-31T19:00:00Z");
const APPROVED_AT = new Date("2026-11-04T07:20:00Z");

describe("payroll.run.disbursed / approved posting-date contract", () => {
  it("payroll emits the shared payload builders: approved carries the marker, disbursed carries the IST payment date and the accrual amounts", () => {
    const src = read("services/payroll-service/src/modules/payroll/consumer.ts");
    expect(src).toMatch(/topic: EVENTS\.runDisbursed[\s\S]{0,200}payload: runDisbursedPayload\(/);
    expect(read("services/finance-service/src/topics.ts")).toMatch(/payrollRunDisbursed:\s*"payroll\.run\.disbursed"/);
    expect(runApprovedPayload(amounts).accrualCarriedOnDisbursal).toBe(true);
    const d = runDisbursedPayload({ ...amounts, disbursedAt: PAID_AT });
    expect(d).toMatchObject({ runId: amounts.runId, month: "2027-03", totalNetMinor: "17392200", totalGrossMinor: "42130800", totalEmployerContribMinor: "4957100", paymentDate: "2027-04-01" });
    expect(d).not.toHaveProperty("accrualCarriedOnDisbursal");
    expect(payrollIstDate(PAID_AT)).toBe(istDateOf(PAID_AT));
  });

  it("finance reads the accounting basis and the shared date rules in both handlers", () => {
    const integ = read("services/finance-service/src/modules/integrations/consumer.ts");
    const at = integ.indexOf("CONSUMED_EVENTS.payrollRunApproved");
    expect(integ.slice(at, at + 2500)).toMatch(/accountingBasis[\s\S]*accrualDateOnApproval\(basis, p, /);
    const gl = read("services/finance-service/src/modules/gl/consumer.ts");
    const g = gl.indexOf("CONSUMED_EVENTS.payrollRunDisbursed");
    expect(gl.slice(g, g + 3500)).toMatch(/accountingBasis[\s\S]*postingDatesOnDisbursal\(basis, p, /);
    // one deterministic accrual journal id on both paths: never posted twice.
    expect(integ).toContain("deterministicId(`payroll_accrual:${p.runId}`)");
    expect(gl).toContain("deterministicId(`payroll_accrual:${p.runId}`)");
  });

  it("cash basis: nothing on approval; accrual and settlement on the payment date -- March pay paid 1 April lands in FY 2027-28", () => {
    const approved = JSON.parse(JSON.stringify(runApprovedPayload(amounts)));
    expect(accrualDateOnApproval("cash", approved, APPROVED_AT)).toBeNull();
    const disbursed = JSON.parse(JSON.stringify(runDisbursedPayload({ ...amounts, disbursedAt: PAID_AT })));
    expect(postingDatesOnDisbursal("cash", disbursed, PAID_AT)).toEqual({ accrualDate: "2027-04-01", settlementDate: "2027-04-01" });
    // The deferred accrual is the same balanced journal the approval would have posted.
    const cmd = payrollAccrualJournalCommand(disbursed, "j-1", "t-1", "2027-04-01") as { voucherNo: string; postingDate: string; lines: Array<{ accountCode: string; debitMinor: string; creditMinor: string }> };
    expect(cmd.voucherNo).toBe(payrollAccrualVoucherNo(amounts));
    expect(cmd.voucherNo).toBe("PAY/2027-03/fa3666c2");
    expect(cmd.postingDate).toBe("2027-04-01");
    expect(cmd.lines.map((l) => [l.accountCode, l.debitMinor, l.creditMinor])).toEqual(payrollAccrualLines(approved).map((l) => [l.accountCode, l.debitMinor.toString(), l.creditMinor.toString()]));
  });

  it("accrual basis: accrual on the last day of the pay month, settlement on the payment date", () => {
    expect(accrualDateOnApproval("accrual", runApprovedPayload(amounts), APPROVED_AT)).toBe("2027-03-31");
    expect(accrualDateOnApproval("accrual", { month: "2028-02" }, APPROVED_AT)).toBe("2028-02-29");
    expect(payMonthEndDate("2027-01")).toBe("2027-01-31");
    const disbursed = JSON.parse(JSON.stringify(runDisbursedPayload({ ...amounts, disbursedAt: PAID_AT })));
    // PR #2459 review SF4: the accrual is re-offered on disbursal, dated the pay-month end;
    // finance posts it only if no accrual journal exists for the run (approved under cash, switched since).
    expect(postingDatesOnDisbursal("accrual", disbursed, PAID_AT)).toEqual({ accrualDate: "2027-03-31", settlementDate: "2027-04-01" });
    const gl = read("services/finance-service/src/modules/gl/consumer.ts");
    expect(gl).toMatch(/findJournalByIdTx\(tx, accrualId\)\)[\s\S]{0,120}findJournalByVoucherNoTx\(tx, msg\.tenantId, payrollAccrualVoucherNo\(p\)\)/);
  });

  it("backward compatible: an older payroll payload posts on approval (cash: IST approval day) and settles on the IST consumption day", () => {
    const legacyApproved = { runId: amounts.runId, month: "2027-03", totalGrossMinor: "42130800", totalNetMinor: "17392200", totalEmployerContribMinor: "4957100" };
    expect(accrualDateOnApproval("cash", legacyApproved, APPROVED_AT)).toBe("2026-11-04");
    expect(accrualDateOnApproval("accrual", legacyApproved, APPROVED_AT)).toBe("2027-03-31");
    const legacyDisbursed = { runId: amounts.runId, month: "2027-03", totalNetMinor: "17392200" };
    // no amounts on the payload -> no deferred accrual to post (it was posted on approval)
    expect(postingDatesOnDisbursal("cash", legacyDisbursed, PAID_AT)).toEqual({ accrualDate: null, settlementDate: "2027-04-01" });
    // IST, not UTC: 00:30 IST on 1 April is 1 April.
    expect(istDateOf(PAID_AT)).toBe("2027-04-01");
    expect(PAID_AT.toISOString().slice(0, 10)).toBe("2027-03-31");
  });
});
