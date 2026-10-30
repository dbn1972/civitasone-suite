/**
 * GAP-CITIZEN-GRIEVANCES-04 (owner decision D4c #2, 2026-10-27): /citizen/grievances is the
 * official register; /citizen/requests is the all-requests view. Both page-level stat grids
 * count through this one helper so the same dataset yields the same numbers on either page.
 *
 * A status the helper does not know counts toward `total` only; it never lands in a bucket
 * by accident.
 */
export type StatusBucket = "open" | "escalated" | "resolved" | "rejected";

const BUCKETS: Record<string, StatusBucket> = {
  submitted: "open",
  pending: "open",
  registered: "open",
  under_review: "open",
  assigned: "open",
  in_progress: "open",
  escalated: "escalated",
  resolved: "resolved",
  closed: "resolved",
  disposed: "resolved",
  rejected: "rejected",
};

export function bucketOf(status: string): StatusBucket | null {
  return BUCKETS[status.trim().toLowerCase()] ?? null;
}

export interface StatusCounts {
  total: number;
  open: number;
  escalated: number;
  resolved: number;
  rejected: number;
}

export function countByBucket(items: ReadonlyArray<{ status: string }>): StatusCounts {
  const out: StatusCounts = { total: items.length, open: 0, escalated: 0, resolved: 0, rejected: 0 };
  for (const it of items) {
    const b = bucketOf(it.status);
    if (b) out[b] += 1;
  }
  return out;
}
