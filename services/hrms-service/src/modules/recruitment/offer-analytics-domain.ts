/**
 * Offer analytics domain (pure) — funnel, acceptance rate, ageing of pending
 * offers, and decline-reason breakdown (R-RA-0167). No I/O; `nowMs` passed in.
 */

export interface OfferStat {
  status: string;                 // draft | sent | pending_approval | returned | approved | released | accepted | declined | withdrawn | expired | revised
  releasedAtMs?: number | null;
  acceptedAtMs?: number | null;
  declineReasonCode?: string | null;
}

export interface Funnel {
  total: number;
  released: number;   // offers that reached the candidate (released or beyond)
  accepted: number;
  declined: number;
  expired: number;
  withdrawn: number;
  pending: number;    // released but not yet decided
}

const DECIDED = new Set(["accepted", "declined", "expired", "withdrawn"]);
const REACHED_CANDIDATE = new Set(["released", "accepted", "declined", "expired", "withdrawn"]);

/** Counts across the offer lifecycle. `released` counts everything that reached the candidate. */
export function offerFunnel(offers: readonly OfferStat[]): Funnel {
  const f: Funnel = { total: offers.length, released: 0, accepted: 0, declined: 0, expired: 0, withdrawn: 0, pending: 0 };
  for (const o of offers) {
    if (REACHED_CANDIDATE.has(o.status)) f.released++;
    if (o.status === "accepted") f.accepted++;
    else if (o.status === "declined") f.declined++;
    else if (o.status === "expired") f.expired++;
    else if (o.status === "withdrawn") f.withdrawn++;
    if (o.status === "released") f.pending++;
  }
  return f;
}

function round1(n: number): number { return Math.round(n * 10) / 10; }

/**
 * Acceptance rate as a percentage of DECIDED offers (accepted / accepted+declined+
 * expired). Withdrawals are employer-initiated so they're excluded from the base.
 * Returns null when nothing has been decided yet.
 */
export function acceptanceRatePct(offers: readonly OfferStat[]): number | null {
  let accepted = 0, base = 0;
  for (const o of offers) {
    if (o.status === "accepted") { accepted++; base++; }
    else if (o.status === "declined" || o.status === "expired") base++;
  }
  return base === 0 ? null : round1((accepted / base) * 100);
}

export interface AgeBucket { label: string; maxDays: number | null; count: number }

/**
 * Ageing of PENDING (released, undecided) offers by days since release. Helps HR
 * chase offers that are going stale. Buckets: 0-3, 4-7, 8-14, 15+ days.
 */
export function pendingAgeing(offers: readonly OfferStat[], nowMs: number): AgeBucket[] {
  const buckets: AgeBucket[] = [
    { label: "0-3d", maxDays: 3, count: 0 },
    { label: "4-7d", maxDays: 7, count: 0 },
    { label: "8-14d", maxDays: 14, count: 0 },
    { label: "15+d", maxDays: null, count: 0 },
  ];
  for (const o of offers) {
    if (o.status !== "released" || o.releasedAtMs == null) continue;
    const days = Math.floor((nowMs - o.releasedAtMs) / 86_400_000);
    const b = buckets.find((x) => x.maxDays != null && days <= x.maxDays) ?? buckets[buckets.length - 1]!;
    b.count++;
  }
  return buckets;
}

/** Count of declined offers grouped by decline-reason code. */
export function declineBreakdown(offers: readonly OfferStat[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of offers) {
    if (o.status !== "declined") continue;
    const code = o.declineReasonCode || "unspecified";
    out[code] = (out[code] ?? 0) + 1;
  }
  return out;
}

export { DECIDED };
