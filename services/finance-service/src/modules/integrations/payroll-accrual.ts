/**
 * payroll.run.approved -> salary GL accrual lines (consumer side). Producer:
 * payroll-service modules/payroll/run-approved-payload.ts; the pair is pinned
 * by tests/contract/payroll-run-approved.contract.test.ts. Pure.
 *
 * H2: the employee-side statutory leg is DERIVED as (gross - net), so Dr gross
 * == Cr net + Cr statutory regardless of how net was clamped; a negative
 * statutory (net > gross, pathological) is booked on the opposite side.
 * H3: all paise stay bigint.
 *
 * Employer legs, each an equal Dr expense / Cr payable pair on the employer
 * contribution heads (5002 / 2103), so the voucher stays balanced:
 *   - employer PF / EPS, ESI and NPS / UPS individual shares (totalEmployerContribMinor);
 *   - UAT b18 (ERP-head decision 2026-11-05, PR #2458), payable to EPFO and
 *     previously not accrued, each on its OWN line: employer EDLI (A/c 21) and
 *     EPF administrative charges (A/c 2); and the Government 8.5% UPS POOL
 *     corpus share, which is not credited to the individual account.
 * The new fields are optional: a payload without them (older payroll build)
 * posts exactly the lines it always did.
 */
import { deductionLines, type AccrualLine, type DeductionKind } from "./payroll-deductions.js";

export interface PayrollRunApprovedPayload {
  runId: string;
  month: string;
  totalGrossMinor: string;
  totalNetMinor: string;
  totalEmployerContribMinor?: string;
  totalEdliMinor?: string;
  totalEpfAdminMinor?: string;
  totalUpsPoolMinor?: string;
  legalEntityId?: string;
  /**
   * UAT T-PERIOD D-10 (b19): employee deductions by type (paise strings; they sum to
   * gross - net). Credited each to its own liability head by deductionLines(); absent
   * (older payroll build) or not summing to gross - net -> the single 2102 leg.
   */
  employeeDeductionsMinor?: Partial<Record<DeductionKind, string>>;
  /**
   * UAT T-PERIOD D-04 (ERP-head decision 2026-11-05): set by a payroll build
   * that also carries the accrual amounts on payroll.run.disbursed, so a
   * cash-basis tenant can defer the accrual to the payment date. Absent (older
   * payroll build): the accrual posts on approval, as before.
   */
  accrualCarriedOnDisbursal?: boolean;
}

/**
 * payroll.run.disbursed (producer: payroll-service run-approved-payload.ts
 * runDisbursedPayload). `paymentDate` (IST calendar date of the disbursal) and
 * the accrual amounts are additive (UAT T-PERIOD D-04); an older payroll build
 * sends runId / month / totalNetMinor only.
 */
export interface PayrollRunDisbursedPayload extends Partial<Omit<PayrollRunApprovedPayload, "runId" | "month" | "totalNetMinor">> {
  runId: string;
  month: string;
  totalNetMinor: string;
  paymentDate?: string;
}

export type PayrollAccountingBasis = "cash" | "accrual";

/** Last calendar day of a YYYY-MM pay month, as YYYY-MM-DD. Pure. */
export function payMonthEndDate(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

/** The Indian Standard Time (UTC+05:30) calendar date of an instant, YYYY-MM-DD. Pure. */
export function istDateOf(at: Date): string {
  return new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * UAT T-PERIOD D-04 (ERP-head decision 2026-11-05): the date of the salary
 * accrual journal when finance consumes payroll.run.approved, by the tenant
 * accounting basis (gl.finance_settings.accounting_basis, #2455):
 *   accrual -> the last day of the pay month (March pay is March expense);
 *   cash    -> null: not posted on approval -- it posts on the payment date
 *              from payroll.run.disbursed (March pay paid on 1 April falls in
 *              the new FY). A payload from an older payroll build (no
 *              accrualCarriedOnDisbursal) still posts on approval, dated the
 *              IST approval day, so nothing is ever left unposted.
 * Was: always the UTC date of the approval (T-PERIOD: Jan/Mar 2027 salary in Nov 2026). Pure.
 */
export function accrualDateOnApproval(basis: PayrollAccountingBasis, p: Pick<PayrollRunApprovedPayload, "month" | "accrualCarriedOnDisbursal">, now: Date): string | null {
  if (basis === "accrual") return payMonthEndDate(p.month);
  return p.accrualCarriedOnDisbursal === true ? null : istDateOf(now);
}

/**
 * UAT T-PERIOD D-04: posting dates when finance consumes payroll.run.disbursed.
 * The settlement (Dr net payable / Cr bank) is dated the payment date on both
 * bases. The accrual, when the payload carries its amounts and it was never
 * posted: cash -> the payment date; accrual -> the last day of the pay month.
 * paymentDate: the payload one, else the IST date now. Pure.
 */
export function postingDatesOnDisbursal(basis: PayrollAccountingBasis, p: Pick<PayrollRunDisbursedPayload, "paymentDate" | "totalGrossMinor" | "month">, now: Date): { accrualDate: string | null; settlementDate: string } {
  const paymentDate = p.paymentDate && ISO_DATE.test(p.paymentDate) ? p.paymentDate : istDateOf(now);
  // PR #2459 review SF4: whenever the payload carries the amounts, the accrual
  // is (re)offered on disbursal -- the handler posts it only if no accrual
  // journal exists for the run (deterministic id + voucher check), so a basis
  // switched between approval (cash: deferred) and disbursal (accrual) never
  // loses it. Dated by the basis in force now.
  const accrualDate = p.totalGrossMinor == null ? null : basis === "cash" ? paymentDate : payMonthEndDate(p.month);
  return { accrualDate, settlementDate: paymentDate };
}

/** Voucher number of a payroll run accrual journal (unchanged format). */
export function payrollAccrualVoucherNo(p: { runId: string; month: string }): string {
  return `PAY/${p.month}/${p.runId.slice(0, 8)}`;
}

/** The finance.gl.post command payload of a payroll accrual journal, dated `postingDate`. Pure. */
export function payrollAccrualJournalCommand(p: PayrollRunApprovedPayload, journalId: string, tenantId: string, postingDate: string, linesOverride?: AccrualLine[]): Record<string, unknown> {
  const lines = linesOverride ?? payrollAccrualLines(p);
  return {
    id: journalId,
    tenantId,
    voucherNo: payrollAccrualVoucherNo(p),
    type: "payroll_accrual",
    postingDate,
    ...(p.legalEntityId ? { legalEntityId: p.legalEntityId } : {}),
    // H3: paise passed as bigint strings so > 2^53 paise stays exact.
    lines: lines.map((l) => ({
      accountCode: l.accountCode,
      debitMinor: l.debitMinor.toString(),
      creditMinor: l.creditMinor.toString(),
      narration: l.narration,
    })),
  };
}

export type { AccrualLine };

export const EMPLOYER_EXPENSE_HEAD = "5002";
export const EMPLOYER_PAYABLE_HEAD = "2103";

function employerPair(lines: AccrualLine[], amount: bigint, expense: string, payable: string): void {
  if (amount <= 0n) return;
  lines.push({ accountCode: EMPLOYER_EXPENSE_HEAD, debitMinor: amount, creditMinor: 0n, narration: expense });
  lines.push({ accountCode: EMPLOYER_PAYABLE_HEAD, debitMinor: 0n, creditMinor: amount, narration: payable });
}

export function payrollAccrualLines(p: PayrollRunApprovedPayload): AccrualLine[] {
  const gross = BigInt(p.totalGrossMinor);
  const net = BigInt(p.totalNetMinor);
  const statutory = gross - net;
  const lines: AccrualLine[] = [
    { accountCode: "5001", debitMinor: gross, creditMinor: 0n, narration: "Salary expense" },
    { accountCode: "2101", debitMinor: 0n, creditMinor: net, narration: "Net salary payable" },
    // UAT T-PERIOD D-10: each employee deduction on its own liability head (see deductionLines()).
    ...deductionLines(statutory, p.employeeDeductionsMinor),
  ];
  employerPair(lines, BigInt(p.totalEmployerContribMinor ?? "0"), "Employer contributions expense", "Employer contributions payable");
  employerPair(lines, BigInt(p.totalEdliMinor ?? "0"), "Employer EDLI contribution (EPFO A/c 21)", "EDLI contribution payable to EPFO (A/c 21)");
  employerPair(lines, BigInt(p.totalEpfAdminMinor ?? "0"), "EPF administrative charges (EPFO A/c 2)", "EPF administrative charges payable to EPFO (A/c 2)");
  employerPair(lines, BigInt(p.totalUpsPoolMinor ?? "0"), "Government UPS pool corpus contribution (8.5%)", "UPS pool corpus contribution payable");
  return lines;
}
