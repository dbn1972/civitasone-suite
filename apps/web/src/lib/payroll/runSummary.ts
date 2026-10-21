import type { PayrollRunDetail } from "@civitasone/types";
import { parseMinor } from "./minor";

/**
 * GAP-PAYROLL-HOME-03/04: the Payroll home KPI tiles.
 *
 * Wire statuses (payroll-service queries.ts mapRunStatus remaps the internal
 * approved/disbursed before the API responds): draft | processing | completed |
 * paid | failed. "completed" means APPROVED and awaiting disbursement -- money
 * has not moved, so it is never counted as paid. "disbursed" is accepted as
 * paid defensively (it is in the shared type but the wire never sends it).
 *
 * The four buckets always partition the runs, so
 *   paid + inProgress + awaitingDisbursement + failed === total
 * and any unknown future status falls into inProgress (the neutral bucket)
 * rather than vanishing from the counts.
 */
export type RunStatusCounts = {
  total: number;
  paid: number;
  inProgress: number;
  awaitingDisbursement: number;
  failed: number;
};

export function summariseRunStatuses(runs: readonly Pick<PayrollRunDetail, "status">[]): RunStatusCounts {
  let paid = 0;
  let awaitingDisbursement = 0;
  let failed = 0;
  for (const r of runs) {
    if (r.status === "paid" || r.status === "disbursed") paid += 1;
    else if (r.status === "completed") awaitingDisbursement += 1;
    else if (r.status === "failed") failed += 1;
  }
  const total = runs.length;
  return { total, paid, awaitingDisbursement, failed, inProgress: total - paid - awaitingDisbursement - failed };
}

/** Plain code-unit comparison (not locale-sensitive), so the pick never varies by browser/OS locale. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The single most recent ACTUALLY-paid run: latest payPeriod (YYYY-MM sorts
 * lexically), ties broken by the later runDate, then by id so the pick is
 * deterministic. The Payroll home tiles use latestPaidPeriodTotals (below)
 * instead, because one period can hold several paid pay-group runs.
 */
export function latestPaidRun<T extends Pick<PayrollRunDetail, "status" | "payPeriod" | "id"> & { runDate?: string }>(
  runs: readonly T[],
): T | null {
  let best: T | null = null;
  for (const r of runs) {
    if (r.status !== "paid" && r.status !== "disbursed") continue;
    if (best === null) { best = r; continue; }
    const byPeriod = cmp(r.payPeriod, best.payPeriod);
    const byDate = cmp(r.runDate ?? "", best.runDate ?? "");
    const byId = cmp(r.id, best.id);
    if (byPeriod > 0 || (byPeriod === 0 && (byDate > 0 || (byDate === 0 && byId > 0)))) best = r;
  }
  return best;
}

export type PaidPeriodTotals = {
  /** The latest payPeriod that has at least one paid run. */
  payPeriod: string;
  /** How many paid runs that period has (pay-group runs create one run per pay group). */
  runCount: number;
  employeeCount: number;
  /**
   * Sum of those runs' integer-paise gross. null when any of them has no valid
   * paise value: an unknown total is shown as a dash, never as a partial sum.
   */
  grossMinor: bigint | null;
};

/**
 * GAP-PAYROLL-HOME-03: the Payroll home "Employees Paid" / "Total Gross" tiles for
 * the LATEST period that has been paid. A period can hold several paid runs
 * (createPayGroupRuns makes one run per pay group, and payroll-service refuses a
 * second non-failed regular run for the same pay group and month), so the tile
 * adds up the paid runs OF THAT ONE PERIOD -- picking a single run would
 * understate the month. Earlier periods are never added in (the same people
 * would be counted again each month). Gross is summed in bigint paise.
 */
export function latestPaidPeriodTotals<
  T extends Pick<PayrollRunDetail, "status" | "payPeriod" | "employeeCount" | "grossMinor">,
>(runs: readonly T[]): PaidPeriodTotals | null {
  const isPaid = (r: Pick<PayrollRunDetail, "status">) => r.status === "paid" || r.status === "disbursed";
  let payPeriod: string | null = null;
  for (const r of runs) {
    if (isPaid(r) && (payPeriod === null || cmp(r.payPeriod, payPeriod) > 0)) payPeriod = r.payPeriod;
  }
  if (payPeriod === null) return null;
  let runCount = 0;
  let employeeCount = 0;
  let grossMinor: bigint | null = 0n;
  for (const r of runs) {
    if (!isPaid(r) || r.payPeriod !== payPeriod) continue;
    runCount += 1;
    employeeCount += r.employeeCount;
    const m = parseMinor(r.grossMinor);
    grossMinor = grossMinor === null || m === null ? null : grossMinor + m;
  }
  return { payPeriod, runCount, employeeCount, grossMinor };
}
