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
}

export interface AccrualLine { accountCode: string; debitMinor: bigint; creditMinor: bigint; narration: string }

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
    statutory >= 0n
      ? { accountCode: "2102", debitMinor: 0n, creditMinor: statutory, narration: "Statutory deductions payable" }
      : { accountCode: "2102", debitMinor: -statutory, creditMinor: 0n, narration: "Statutory deductions payable" },
  ];
  employerPair(lines, BigInt(p.totalEmployerContribMinor ?? "0"), "Employer contributions expense", "Employer contributions payable");
  employerPair(lines, BigInt(p.totalEdliMinor ?? "0"), "Employer EDLI contribution (EPFO A/c 21)", "EDLI contribution payable to EPFO (A/c 21)");
  employerPair(lines, BigInt(p.totalEpfAdminMinor ?? "0"), "EPF administrative charges (EPFO A/c 2)", "EPF administrative charges payable to EPFO (A/c 2)");
  employerPair(lines, BigInt(p.totalUpsPoolMinor ?? "0"), "Government UPS pool corpus contribution (8.5%)", "UPS pool corpus contribution payable");
  return lines;
}
