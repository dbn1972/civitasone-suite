/** The summary's `totals`, as the page reads them (everything optional: a field the server omitted is "—", not 0). */
export type MonitoringTotals = {
  count?: unknown;
  allocatedMinor?: unknown;
  committedMinor?: unknown;
  actualMinor?: unknown;
  exceptions?: Record<string, unknown>;
};

export const exceptionCount = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * GAP-FINANCE-BUDGET-MONITORING-04: heads on track = heads - heads with an
 * exception. null (rendered "—") when the head count is not a finite number --
 * an absent count must not read as "nothing on track". Clamped at 0 because
 * the three exception buckets could overlap.
 */
export function onTrackCount(totals: MonitoringTotals): number | null {
  const count = typeof totals.count === "number" ? totals.count : typeof totals.count === "string" && totals.count.trim() !== "" ? Number(totals.count) : NaN;
  if (!Number.isFinite(count)) return null;
  const ex = totals.exceptions ?? {};
  return Math.max(0, count - exceptionCount(ex.over_committed) - exceptionCount(ex.under_utilised) - exceptionCount(ex.projected_overspend));
}

