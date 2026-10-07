/**
 * GAP-PROCUREMENT-GEM-04 (status vocabulary) + GAP-PROCUREMENT-GEM-02 (spend):
 *
 * `GemItem.gemStatus` arrives as a free-form string from the (not-yet-fully-
 * specified) GeM items feed. The page previously compared it to the literals
 * "Delivered" / "In Transit" / "Shipped" and silently dropped every other
 * value from the stat cards while STILL summing it into Total Value — so the
 * cards did not reconcile to Total Orders, and cancelled/returned orders
 * inflated spend.
 *
 * Until the backend publishes an authoritative enum, we:
 *  - normalise case/spacing so "in transit", "In_Transit", "IN TRANSIT" all map
 *    to one bucket;
 *  - classify every order into exactly one display bucket (delivered /
 *    inTransit / cancelled / other) so the four counts always sum to the total;
 *  - count toward SPEND only the statuses that represent real, non-cancelled
 *    spend. An unknown status is conservatively counted as spend-bearing (it is
 *    a placed order we cannot prove was cancelled) but is surfaced in the
 *    "Other" bucket so it is visible, not hidden.
 */
export type GemStatusBucket = "delivered" | "inTransit" | "cancelled" | "other";

function normalise(status: string): string {
  return status.trim().toLowerCase().replace(/[_\s]+/g, " ");
}

const DELIVERED = new Set(["delivered", "completed", "received"]);
const IN_TRANSIT = new Set(["in transit", "shipped", "dispatched", "out for delivery"]);
const CANCELLED = new Set(["cancelled", "canceled", "returned", "rejected", "refunded"]);

export function classifyGemStatus(status: string | null | undefined): GemStatusBucket {
  const key = normalise(status ?? "");
  if (DELIVERED.has(key)) return "delivered";
  if (IN_TRANSIT.has(key)) return "inTransit";
  if (CANCELLED.has(key)) return "cancelled";
  return "other";
}

/** A cancelled/returned order is NOT spend; everything else is. */
export function countsAsSpend(status: string | null | undefined): boolean {
  return classifyGemStatus(status) !== "cancelled";
}

export type GemBucketCounts = {
  delivered: number;
  inTransit: number;
  cancelled: number;
  other: number;
  total: number;
};

export function bucketCounts(statuses: Array<string | null | undefined>): GemBucketCounts {
  const counts: GemBucketCounts = { delivered: 0, inTransit: 0, cancelled: 0, other: 0, total: 0 };
  for (const s of statuses) {
    counts[classifyGemStatus(s)] += 1;
    counts.total += 1;
  }
  return counts;
}
