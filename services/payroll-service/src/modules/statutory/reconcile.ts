import type { HrmsGpfAccountParams, HrmsNpsAccountParams } from "../../shared/hrms-retirement-client.js";

/**
 * GAP-PAYROLL-STATUTORY-GPF-02 / NPS-02: read-only comparison of payroll's
 * per-run ledger row against the employee's hrms-service account. It does NOT
 * pick an authoritative ledger -- it only flags divergence so HR can fix the
 * stale side.
 *   match            payroll figure agrees with the hrms account
 *   mismatch         both exist but disagree
 *   no_hrms_account  HRMS is reachable but has no active account for the employee
 *   hrms_unavailable HRMS could not be reached, or the account list was cut off
 *                    before this employee (no verdict is given -- absence in a
 *                    truncated list is NOT proof there is no account)
 */
/** How much of the hrms account list payroll actually holds. */
export type HrmsCoverage = "complete" | "partial" | "unavailable";

export type ReconciliationStatus = "match" | "mismatch" | "no_hrms_account" | "hrms_unavailable";

export type GpfReconciliation = { status: ReconciliationStatus; hrmsMonthlySubscriptionMinor: string | null };
export type NpsReconciliation = { status: ReconciliationStatus; hrmsEmpContribPct: number | null; hrmsErContribPct: number | null };

const isActive = (status: string): boolean => status === "active";

export function reconcileGpf(payrollEmpContribMinor: bigint, account: HrmsGpfAccountParams | undefined, coverage: HrmsCoverage): GpfReconciliation {
  if (coverage === "unavailable" || (coverage === "partial" && !account)) return { status: "hrms_unavailable", hrmsMonthlySubscriptionMinor: null };
  if (!account || !isActive(account.status)) return { status: "no_hrms_account", hrmsMonthlySubscriptionMinor: null };
  return {
    status: account.monthlySubscriptionMinor === payrollEmpContribMinor ? "match" : "mismatch",
    hrmsMonthlySubscriptionMinor: account.monthlySubscriptionMinor.toString(),
  };
}

export function reconcileNps(payrollEmpPct: number, payrollErPct: number, account: HrmsNpsAccountParams | undefined, coverage: HrmsCoverage): NpsReconciliation {
  if (coverage === "unavailable" || (coverage === "partial" && !account)) return { status: "hrms_unavailable", hrmsEmpContribPct: null, hrmsErContribPct: null };
  if (!account || !isActive(account.status)) return { status: "no_hrms_account", hrmsEmpContribPct: null, hrmsErContribPct: null };
  const same = Math.abs(account.empContribPct - payrollEmpPct) < 0.005 && Math.abs(account.erContribPct - payrollErPct) < 0.005;
  return { status: same ? "match" : "mismatch", hrmsEmpContribPct: account.empContribPct, hrmsErContribPct: account.erContribPct };
}
