/**
 * Service Recovery — pure domain logic.
 *
 * Determines eligibility for goodwill recovery, recommends actions within
 * policy limits, and validates approval authority.
 */
import type { RecoveryActionType, RecoveryActionStatus } from "./schema.js";

// --- Severity ordering (higher index = higher severity) ---

const SEVERITY_ORDER: readonly string[] = ["low", "medium", "high", "critical"];

function severityIndex(severity: string): number {
  return SEVERITY_ORDER.indexOf(severity.toLowerCase());
}

// --- Public interfaces ---

/** Minimal ticket shape needed for recovery eligibility check. */
export interface TicketForRecovery {
  id: string;
  severity: string;
  productCode?: string | null | undefined;
}

/** A recovery policy as returned from the database. */
export interface RecoveryPolicy {
  id: string;
  tenantId: string;
  severityThreshold: string;
  productCode?: string | null | undefined;
  maxGoodwillMinor: bigint;
  currency: string;
  requiresApproval: boolean;
  approverRole: string;
  active: boolean;
}

/** Recommendation output from the domain. */
export interface RecoveryActionRecommendation {
  actionType: RecoveryActionType;
  amountMinor: bigint | null;
  currency: string;
  policyId: string;
  reason: string;
}

// --- Status transitions ---

const ALLOWED_TRANSITIONS: Record<RecoveryActionStatus, RecoveryActionStatus[]> = {
  pending_approval: ["approved", "rejected"],
  approved: ["executed"],
  rejected: [],
  executed: [],
};

/**
 * Checks if a status transition is allowed.
 */
export function canTransition(from: RecoveryActionStatus, to: RecoveryActionStatus): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

// --- Eligibility ---

/**
 * Determines if a ticket is eligible for service recovery based on active policies.
 * Returns the best-matching policy (most specific product match + highest threshold)
 * or null if ineligible.
 *
 * Matching logic:
 *  1. Ticket severity must be at or above the policy's severity threshold.
 *  2. If policy has a product_code, it must match the ticket's product.
 *  3. A product-specific policy takes priority over a generic one.
 */
export function isEligibleForRecovery(
  ticket: TicketForRecovery,
  policies: RecoveryPolicy[],
): RecoveryPolicy | null {
  const ticketSeverityIdx = severityIndex(ticket.severity);
  if (ticketSeverityIdx < 0) return null; // unknown severity

  const matching = policies.filter((p) => {
    if (!p.active) return false;
    const thresholdIdx = severityIndex(p.severityThreshold);
    if (thresholdIdx < 0) return false;
    // Ticket severity must meet or exceed the policy threshold
    if (ticketSeverityIdx < thresholdIdx) return false;
    // Product match: if policy is product-specific, ticket must match
    if (p.productCode) {
      if (!ticket.productCode) return false;
      if (p.productCode.toLowerCase() !== ticket.productCode.toLowerCase()) return false;
    }
    return true;
  });

  if (matching.length === 0) return null;

  // Prefer product-specific policies, then highest maxGoodwillMinor
  matching.sort((a, b) => {
    const aHasProduct = a.productCode ? 1 : 0;
    const bHasProduct = b.productCode ? 1 : 0;
    if (bHasProduct !== aHasProduct) return bHasProduct - aHasProduct;
    // Higher limit preferred (more generous policy)
    if (a.maxGoodwillMinor > b.maxGoodwillMinor) return -1;
    if (a.maxGoodwillMinor < b.maxGoodwillMinor) return 1;
    return 0;
  });

  return matching[0] ?? null;
}

// --- Recommendation ---

/**
 * Recommends an appropriate recovery action based on the policy and ticket.
 *
 * Heuristics:
 *  - Critical severity → suggest full max goodwill credit
 *  - High severity → suggest 50% of max goodwill credit
 *  - Otherwise → suggest apology communication (no monetary component)
 */
export function recommendAction(
  policy: RecoveryPolicy,
  ticket: TicketForRecovery,
): RecoveryActionRecommendation {
  const ticketSeverityIdx = severityIndex(ticket.severity);
  const criticalIdx = severityIndex("critical");
  const highIdx = severityIndex("high");

  if (ticketSeverityIdx >= criticalIdx) {
    return {
      actionType: "goodwill_credit",
      amountMinor: policy.maxGoodwillMinor,
      currency: policy.currency,
      policyId: policy.id,
      reason: `Critical severity ticket — full goodwill credit recommended`,
    };
  }

  if (ticketSeverityIdx >= highIdx) {
    const halfAmount = policy.maxGoodwillMinor / 2n;
    return {
      actionType: "goodwill_credit",
      amountMinor: halfAmount > 0n ? halfAmount : 1n,
      currency: policy.currency,
      policyId: policy.id,
      reason: `High severity ticket — 50% goodwill credit recommended`,
    };
  }

  // Medium or lower
  return {
    actionType: "apology_comm",
    amountMinor: null,
    currency: policy.currency,
    policyId: policy.id,
    reason: `Severity below high — apology communication recommended`,
  };
}

// --- Approval authority ---

/**
 * Checks if the approver has the required role for the action's policy.
 */
export function canApprove(
  requiredRole: string,
  approverRoles: string[],
): boolean {
  // super_admin and helpdesk_admin can always approve
  if (approverRoles.includes("super_admin") || approverRoles.includes("helpdesk_admin")) {
    return true;
  }
  return approverRoles.includes(requiredRole);
}

// --- Amount validation ---

/**
 * Validates that the requested amount does not exceed the policy limit.
 * Returns true if valid (within bounds).
 */
export function validateAmount(amountMinor: bigint | null, policy: RecoveryPolicy): boolean {
  if (amountMinor === null) return true; // non-monetary actions
  if (amountMinor <= 0n) return false;
  return amountMinor <= policy.maxGoodwillMinor;
}
