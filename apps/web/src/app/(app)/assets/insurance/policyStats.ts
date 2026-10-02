/**
 * GAP-ASSETS-INSURANCE-04: pure derivation of the policy stat tiles.
 *
 * Every policy lands in exactly ONE of Active / Expiring / Lapsed, so the
 * tiles can no longer disagree with each other:
 *  - Lapsed   = end date before today (IST), OR a status that is no longer in
 *               force (expired / lapsed / cancelled), however stale the flag.
 *  - Expiring = in force and ending today..today+30 days (a policy ending
 *               today is Expiring, not Lapsed).
 *  - Active   = in force and ending after the expiring window.
 * Only "active" status counts as in force; any other non-lapsed status
 * (e.g. an unknown one) lands in Other, so the four buckets always sum to Total.
 */
export type StatPolicy = { status: string; endDate: string };

export const EXPIRING_WINDOW_DAYS = 30;
const OUT_OF_FORCE = new Set(["expired", "lapsed", "cancelled", "canceled"]);

function dayNumber(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
}

export type PolicyBucket = "active" | "expiring" | "lapsed" | "other";

export function bucketPolicy(p: StatPolicy, today: string): PolicyBucket {
  const status = p.status.toLowerCase();
  const end = dayNumber(p.endDate);
  const now = dayNumber(today);
  if (OUT_OF_FORCE.has(status)) return "lapsed";
  if (end !== null && now !== null && end < now) return "lapsed";
  if (status !== "active") return "other";
  if (end !== null && now !== null && end - now <= EXPIRING_WINDOW_DAYS) return "expiring";
  return "active";
}

export function derivePolicyStats(policies: StatPolicy[], today: string) {
  const stats = { total: policies.length, active: 0, expiring: 0, lapsed: 0, other: 0 };
  for (const p of policies) {
    const b = bucketPolicy(p, today);
    stats[b] += 1;
  }
  return stats;
}
