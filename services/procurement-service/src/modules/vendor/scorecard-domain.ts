/**
 * SVC-049 Vendor performance — pure scoring + show-cause domain logic.
 *
 * The scorecard is objective: it is derived only from tallied performance
 * events (GRN acceptance/rejection, late deliveries, SLA breaches). No
 * subjective input feeds the rating.
 */

export class ScorecardDomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "ScorecardDomainError";
  }
}

export const PERFORMANCE_EVENT_TYPES = [
  "grn_accepted", "grn_rejected", "delivery_late", "delivery_on_time", "sla_breach",
] as const;
export type PerformanceEventType = (typeof PERFORMANCE_EVENT_TYPES)[number];

export const PERFORMANCE_SOURCES = ["grn", "contract", "manual"] as const;
export type PerformanceSource = (typeof PERFORMANCE_SOURCES)[number];

export interface EventTally {
  grnAccepted: number;
  grnRejected: number;
  deliveryLate: number;
  deliveryOnTime: number;
  slaBreach: number;
}

export interface Scorecard {
  totalOrders: number;
  onTimeDeliveries: number;
  lateDeliveries: number;
  qualityRejections: number;
  slaBreaches: number;
  deliveryScore: number;
  qualityScore: number;
  slaScore: number;
  overallRating: number;
  ratingBand: "A" | "B" | "C" | "D" | "unrated";
}

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Map an aggregate overall rating (0-100) to a rating band. */
export function ratingBand(totalOrders: number, overall: number): Scorecard["ratingBand"] {
  if (totalOrders === 0) return "unrated";
  if (overall >= 85) return "A";
  if (overall >= 70) return "B";
  if (overall >= 50) return "C";
  return "D";
}

/**
 * Compute an objective vendor scorecard from an event tally.
 *
 * Weights: delivery 40%, quality 40%, SLA 20%.
 *  - deliveryScore = onTime / totalOrders
 *  - qualityScore  = (totalOrders - qualityRejections) / totalOrders
 *  - slaScore      = 100 - 20 per SLA breach (floored at 0)
 * With no orders the vendor is "unrated" (all scores 0).
 */
export function computeScorecard(t: EventTally): Scorecard {
  const totalOrders = t.grnAccepted + t.grnRejected;
  const lateDeliveries = t.deliveryLate;
  const onTimeDeliveries = clamp(t.grnAccepted - t.deliveryLate + t.deliveryOnTime, 0, Number.MAX_SAFE_INTEGER);
  const qualityRejections = t.grnRejected;
  const slaBreaches = t.slaBreach;

  const deliveryScore = totalOrders > 0 ? Math.round(clamp((onTimeDeliveries / totalOrders) * 100)) : 0;
  const qualityScore = totalOrders > 0 ? Math.round(clamp(((totalOrders - qualityRejections) / totalOrders) * 100)) : 0;
  const slaScore = clamp(100 - slaBreaches * 20);

  const overallRating = totalOrders > 0
    ? Math.round(clamp(0.4 * deliveryScore + 0.4 * qualityScore + 0.2 * slaScore))
    : 0;

  return {
    totalOrders, onTimeDeliveries, lateDeliveries, qualityRejections, slaBreaches,
    deliveryScore, qualityScore, slaScore, overallRating,
    ratingBand: ratingBand(totalOrders, overallRating),
  };
}

/** Map an inbound domain event topic to a performance event type + source. */
export function classifyPerformanceEvent(topic: string): { eventType: PerformanceEventType; source: PerformanceSource } | null {
  switch (topic) {
    case "procurement.grn.accepted": return { eventType: "grn_accepted", source: "grn" };
    case "procurement.grn.rejected": return { eventType: "grn_rejected", source: "grn" };
    case "contract.contract.terminated": return { eventType: "sla_breach", source: "contract" };
    default: return null;
  }
}

// ── Show-cause workflow ──────────────────────────────────────────
export type ShowCauseStatus = "issued" | "responded" | "appealed" | "upheld" | "closed";

const SHOW_CAUSE_TRANSITIONS: Record<ShowCauseStatus, ShowCauseStatus[]> = {
  issued:    ["responded", "closed"],
  responded: ["appealed", "upheld", "closed"],
  appealed:  ["upheld", "closed"],
  upheld:    ["closed"],
  closed:    [],
};

export function assertShowCauseTransition(from: string, to: ShowCauseStatus): void {
  const allowed = SHOW_CAUSE_TRANSITIONS[from as ShowCauseStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new ScorecardDomainError("INVALID_TRANSITION", `show-cause cannot transition from '${from}' to '${to}'`);
  }
}

/** Maker-checker: the show-cause decider (checker) must differ from the issuer (maker). */
export function assertDistinctIssuerDecider(issuerId: string, deciderId: string): void {
  if (issuerId && deciderId && issuerId === deciderId) {
    throw new ScorecardDomainError("SOD_VIOLATION", "issuer and decider must be different actors");
  }
}
