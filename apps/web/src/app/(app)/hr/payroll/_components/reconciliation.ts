/**
 * GAP-PAYROLL-STATUTORY-GPF-02 / NPS-02: payroll-service flags, per ledger
 * row, whether the figure agrees with the employee's hrms-service GPF / NPS
 * account. This maps that verdict to the i18n key suffix both pages share and
 * counts the rows needing attention (kept out of page.tsx so the
 * empty-vs-error guard has nothing to trip on).
 */
export type ReconciliationStatus = "match" | "mismatch" | "no_hrms_account" | "hrms_unavailable";

export type RowReconciliation = { status: ReconciliationStatus } | null | undefined;

const KEY: Record<ReconciliationStatus, string> = {
  match: "reconcileMatch",
  mismatch: "reconcileMismatch",
  no_hrms_account: "reconcileNoHrmsAccount",
  hrms_unavailable: "reconcileHrmsUnavailable",
};

/** i18n key for a row's verdict; an older server that sends none shows "unavailable". */
export function reconciliationKey(r: RowReconciliation): string {
  return KEY[r?.status ?? "hrms_unavailable"] ?? KEY.hrms_unavailable;
}

/** Rows where the two ledgers disagree or HRMS has no account (verdict-bearing only). */
export function countNeedingAttention(rows: readonly { reconciliation?: RowReconciliation }[]): number {
  return rows.filter((r) => r.reconciliation?.status === "mismatch" || r.reconciliation?.status === "no_hrms_account").length;
}
