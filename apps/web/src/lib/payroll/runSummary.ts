import type { PayrollRunDetail } from "@civitasone/types";
import { isPaidPayrollRunStatus } from "./statusLabels";
import { minorOrLegacy } from "./runMoney";

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
    if (isPaidPayrollRunStatus(r.status)) paid += 1;
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
    if (!isPaidPayrollRunStatus(r.status)) continue;
    if (best === null) { best = r; continue; }
    const byPeriod = cmp(r.payPeriod, best.payPeriod);
    const byDate = cmp(r.runDate ?? "", best.runDate ?? "");
    const byId = cmp(r.id, best.id);
    if (byPeriod > 0 || (byPeriod === 0 && (byDate > 0 || (byDate === 0 && byId > 0)))) best = r;
  }
  return best;
}

export type PaidPeriodTotals = {
  /**
   * The latest payPeriod whose REGULAR payroll has a paid run. Only when no
   * regular run has ever been paid does it fall back to the latest period with
   * a paid run of any type (so money that was paid is never hidden).
   */
  payPeriod: string;
  /** How many paid runs of ANY type that period has: the runs grossMinor is summed over. */
  runCount: number;
  /**
   * Headcount: employeeCount summed over the period's paid REGULAR runs only
   * (pay-group runs of one month are separate regular runs and do add up).
   * Supplementary, arrears and pensioner runs are excluded: they re-pay
   * employees already in the regular run or add pensioners, so including them
   * counts the same people twice.
   */
  employeeCount: number;
  /**
   * Sum of the gross of ALL the period's paid runs (regular, supplementary,
   * arrears and pensioner): the tile is labelled all paid runs, because
   * leaving a paid arrears run out would understate the money actually paid in
   * the period. null when any of them has no valid paise value: an unknown
   * total is shown as a dash, never as a partial sum.
   */
  grossMinor: bigint | null;
};

/**
 * GAP-PAYROLL-HOME-03: the Payroll home Employees Paid / Total Gross tiles for
 * the LATEST period whose regular payroll has been paid. A period can hold
 * several paid regular runs (createPayGroupRuns makes one run per pay group, and
 * payroll-service refuses a second non-failed regular run for the same pay group
 * and month), so the headcount adds up the paid REGULAR runs of that one period
 * -- picking a single run would understate the month. Earlier periods are never
 * added in (the same people would be counted again each month).
 *
 * GET /v1/payroll/runs also lists supplementary, arrears and pensioner runs
 * (run_type), which coexist with the regular run of a month. They are left out
 * of the headcount (a paid arrears run re-pays people the regular run already
 * counted; a pensioner run adds pensioners) but their gross IS in Total Gross,
 * which is therefore labelled all paid runs. A run with no runType (an older
 * payroll-service) is a regular run. An unrecognised runType is not regular, so
 * it can never inflate the headcount. Gross is summed in bigint paise.
 */
export function latestPaidPeriodTotals<
  T extends Pick<PayrollRunDetail, "status" | "payPeriod" | "employeeCount" | "grossMinor" | "grossAmount" | "runType">,
>(runs: readonly T[]): PaidPeriodTotals | null {
  const isPaid = (r: Pick<PayrollRunDetail, "status">) => isPaidPayrollRunStatus(r.status);
  const isRegular = (r: Pick<PayrollRunDetail, "runType">) => (r.runType ?? "regular") === "regular";
  let regularPeriod: string | null = null;
  let anyPeriod: string | null = null;
  for (const r of runs) {
    if (!isPaid(r)) continue;
    if (anyPeriod === null || cmp(r.payPeriod, anyPeriod) > 0) anyPeriod = r.payPeriod;
    if (isRegular(r) && (regularPeriod === null || cmp(r.payPeriod, regularPeriod) > 0)) regularPeriod = r.payPeriod;
  }
  const payPeriod = regularPeriod ?? anyPeriod;
  if (payPeriod === null) return null;
  let runCount = 0;
  let employeeCount = 0;
  let grossMinor: bigint | null = 0n;
  for (const r of runs) {
    if (!isPaid(r) || r.payPeriod !== payPeriod) continue;
    runCount += 1;
    if (isRegular(r)) employeeCount += r.employeeCount;
    // Same adapter as every other payroll-run screen (GAP-PAYROLL-RUNS-01): exact paise
    // string first, the legacy rupee float only when the string is absent.
    const m = minorOrLegacy(r.grossMinor, r.grossAmount);
    grossMinor = grossMinor === null || m === null ? null : grossMinor + m;
  }
  return { payPeriod, runCount, employeeCount, grossMinor };
}
