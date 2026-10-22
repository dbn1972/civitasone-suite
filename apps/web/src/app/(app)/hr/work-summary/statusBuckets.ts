/**
 * GAP-HR-WORK-SUMMARY-02: stat-tile bucketing for the work-summary page.
 *
 * The page used to count "Reviewed" (approved/accepted/finalised) and
 * "Pending" (pending/submitted) from two fixed lists, so every appraisal in
 * any other stage was in the Total tile only and the tiles never added up.
 * The real status vocabulary lives in two modules that write the same
 * appraisal.hrms_appraisals table (appraisals/routes.ts APPRAISAL_STAGES and
 * apar/routes.ts APAR_STAGES; DB check: migration 0153):
 *   pending, in_review, completed, self_pending, reporting_officer,
 *   reviewing_officer, accepting_authority, disclosed, representation,
 *   finalised
 * plus the legacy approved/accepted/submitted values this page always
 * listed. Every status now lands in exactly one bucket, with "other" as the
 * catch-all (including any value not listed here), so
 * reviewed + pending + other === total by construction.
 */

/** Review finished: a terminal outcome has been recorded. */
export const REVIEWED_STATUSES: readonly string[] = ["approved", "accepted", "finalised", "completed"];

/** Not yet picked up by a reviewer: waiting on the first action. */
export const PENDING_STATUSES: readonly string[] = ["pending", "submitted", "self_pending"];

export type StatusBuckets = { reviewed: number; pending: number; other: number };

/** Buckets a status -> count map (e.g. the API's statusCounts). */
export function bucketStatusCounts(counts: Record<string, number>): StatusBuckets {
  const out: StatusBuckets = { reviewed: 0, pending: 0, other: 0 };
  for (const [status, raw] of Object.entries(counts)) {
    const n = Number(raw) || 0;
    if (REVIEWED_STATUSES.includes(status)) out.reviewed += n;
    else if (PENDING_STATUSES.includes(status)) out.pending += n;
    else out.other += n;
  }
  return out;
}

/** Fallback when the API response carries no statusCounts: count the rows we have. */
export function countByStatus(rows: ReadonlyArray<{ status: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return counts;
}
