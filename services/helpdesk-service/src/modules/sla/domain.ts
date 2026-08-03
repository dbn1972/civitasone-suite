/**
 * SLA Engine — pure domain logic.
 *
 * Computes response/resolution deadlines from tenant-configured SLA policies,
 * evaluates at-risk (80% of resolution elapsed) and breach (deadline exceeded)
 * conditions.
 *
 * All time values in minutes for policy storage and milliseconds for computation.
 */

/** A configured SLA policy per priority + category. */
export interface SlaPolicy {
  id: string;
  tenantId: string;
  priority: string;
  category: string | null;
  responseMinutes: number;
  resolutionMinutes: number;
}

/** Computed deadlines from a policy and ticket creation time. */
export interface SlaDeadlines {
  responseDeadline: Date;
  resolutionDeadline: Date;
}

/**
 * Compute response and resolution deadlines for a ticket based on its SLA policy.
 */
export function computeDeadlines(createdAt: Date, policy: SlaPolicy): SlaDeadlines {
  const createdMs = createdAt.getTime();
  return {
    responseDeadline: new Date(createdMs + policy.responseMinutes * 60_000),
    resolutionDeadline: new Date(createdMs + policy.resolutionMinutes * 60_000),
  };
}

/**
 * Determine if a ticket is at-risk: elapsed time has reached 80% of
 * the resolution window.
 *
 * @param now - current time
 * @param createdAt - ticket creation time
 * @param resolutionDeadline - computed resolution deadline
 * @returns true when elapsed ≥ 80% of total window and deadline not yet passed
 */
export function isAtRisk(now: Date, createdAt: Date, resolutionDeadline: Date): boolean {
  const totalWindow = resolutionDeadline.getTime() - createdAt.getTime();
  if (totalWindow <= 0) return false;
  const elapsed = now.getTime() - createdAt.getTime();
  const threshold = totalWindow * 0.8;
  // At risk: elapsed ≥ 80% but NOT yet breached (elapsed < 100%)
  return elapsed >= threshold && elapsed < totalWindow;
}

/**
 * Determine if a ticket has breached its SLA deadline.
 *
 * @param now - current time
 * @param deadline - the SLA deadline (response or resolution)
 * @returns true when current time exceeds the deadline
 */
export function isBreached(now: Date, deadline: Date): boolean {
  return now.getTime() >= deadline.getTime();
}

/** SLA evaluation status */
export type SlaEvalStatus = "within_sla" | "at_risk" | "breached";

/**
 * Evaluate the SLA status for a ticket given the current time and its policy.
 * Precedence: breached > at_risk > within_sla
 */
export function evaluateSlaStatus(
  now: Date,
  createdAt: Date,
  policy: SlaPolicy,
): { status: SlaEvalStatus; deadlines: SlaDeadlines } {
  const deadlines = computeDeadlines(createdAt, policy);

  if (isBreached(now, deadlines.resolutionDeadline)) {
    return { status: "breached", deadlines };
  }
  if (isAtRisk(now, createdAt, deadlines.resolutionDeadline)) {
    return { status: "at_risk", deadlines };
  }
  return { status: "within_sla", deadlines };
}

/**
 * Validate CSAT rating — must be integer 1–5.
 */
export function isValidCsatRating(rating: number): boolean {
  return Number.isInteger(rating) && rating >= 1 && rating <= 5;
}

/**
 * Check if a CSAT survey should be sent — within 15 minutes of resolution.
 *
 * @param resolvedAt - when the ticket was resolved
 * @param now - current time
 * @returns true if within the 15-minute CSAT window
 */
export function isCsatWindowOpen(resolvedAt: Date, now: Date): boolean {
  const windowMs = 15 * 60_000; // 15 minutes
  const elapsed = now.getTime() - resolvedAt.getTime();
  return elapsed >= 0 && elapsed <= windowMs;
}

/**
 * Highest CSAT rating (1–5 scale) still counted as a detractor. A detractor
 * response opens a service-recovery escalation rather than closing the loop.
 */
export const CSAT_DETRACTOR_MAX_RATING = 2;

/** True when a CSAT rating is low enough to require service recovery. */
export function isCsatDetractor(rating: number): boolean {
  return isValidCsatRating(rating) && rating <= CSAT_DETRACTOR_MAX_RATING;
}

/** Default SLA policies when no tenant config exists. */
export const DEFAULT_SLA_POLICIES: Omit<SlaPolicy, "id" | "tenantId">[] = [
  { priority: "critical", category: null, responseMinutes: 30, resolutionMinutes: 240 },
  { priority: "high", category: null, responseMinutes: 60, resolutionMinutes: 480 },
  { priority: "medium", category: null, responseMinutes: 240, resolutionMinutes: 1440 },
  { priority: "low", category: null, responseMinutes: 480, resolutionMinutes: 2880 },
];

/**
 * Find the best matching SLA policy for a ticket: prefer category-specific match,
 * fall back to priority-only (category=null), then fall back to defaults.
 */
export function resolvePolicy(
  policies: SlaPolicy[],
  priority: string,
  category: string | null,
): SlaPolicy | null {
  const normalPriority = priority.toLowerCase();

  // 1. Exact match: priority + category
  if (category) {
    const exact = policies.find(
      (p) => p.priority.toLowerCase() === normalPriority && p.category?.toLowerCase() === category.toLowerCase(),
    );
    if (exact) return exact;
  }

  // 2. Priority-only match (category=null in policy)
  const priorityOnly = policies.find(
    (p) => p.priority.toLowerCase() === normalPriority && (p.category === null || p.category === ""),
  );
  if (priorityOnly) return priorityOnly;

  return null;
}
