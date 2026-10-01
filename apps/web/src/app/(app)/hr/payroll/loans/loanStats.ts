/**
 * GAP-PAYROLL-LOANS-03: loan summary stats for the loans page.
 *
 * Status enum (payroll-service migration 0027 payroll_loans_status_check):
 * applied, approved, disbursed, repaying, closed, rejected.
 *  - "Active" = money is out and being recovered: disbursed | repaying.
 *    "applied"/"approved" are not yet disbursed (counted separately as
 *    pending); "closed"/"rejected" are finished.
 *  - Outstanding and monthly EMI are summed over active loans only -- an
 *    undisbursed loan's outstanding_minor is pre-set to its principal and
 *    its EMI is not yet being deducted, and a closed loan recovers nothing.
 * Sums are bigint (minor units arrive as strings from the API).
 */
export const ACTIVE_LOAN_STATUSES: readonly string[] = ["disbursed", "repaying"];
export const PENDING_LOAN_STATUSES: readonly string[] = ["applied", "approved"];

type StatRow = { status: string; outstandingMinor: string | number; emiMinor: string | number };

function toMinor(v: string | number | null | undefined): bigint {
  if (v === null || v === undefined || v === "") return 0n;
  if (typeof v === "number") return Number.isFinite(v) ? BigInt(Math.trunc(v)) : 0n;
  return /^-?\d+$/.test(v.trim()) ? BigInt(v.trim()) : 0n;
}

export type LoanStats = {
  total: number;
  active: number;
  pending: number;
  outstandingMinor: bigint;
  monthlyEmiMinor: bigint;
};

export function computeLoanStats(rows: readonly StatRow[]): LoanStats {
  let active = 0;
  let pending = 0;
  let outstandingMinor = 0n;
  let monthlyEmiMinor = 0n;
  for (const r of rows) {
    if (ACTIVE_LOAN_STATUSES.includes(r.status)) {
      active += 1;
      outstandingMinor += toMinor(r.outstandingMinor);
      monthlyEmiMinor += toMinor(r.emiMinor);
    } else if (PENDING_LOAN_STATUSES.includes(r.status)) {
      pending += 1;
    }
  }
  return { total: rows.length, active, pending, outstandingMinor, monthlyEmiMinor };
}
