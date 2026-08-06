/**
 * winback/domain.ts — Pure win-back cadence logic.
 *
 * Functions here decide enrollment eligibility, step advancement, cancellation
 * rules, and outcome recording. No I/O, no clock dependency (dates passed in),
 * no randomness — fully deterministic and unit-testable.
 */

import type {
  TriggerCriteria,
  CadenceStep,
  WinbackCadenceView,
  WinbackEnrollmentView,
} from "./schema.js";

// ── Types ───────────────────────────────────────────────────────────────────

export type CadenceStatus = "draft" | "active" | "archived";
export const CADENCE_STATUSES: readonly CadenceStatus[] = ["draft", "active", "archived"];

export type EnrollmentStatus = "active" | "completed" | "cancelled" | "converted";
export const ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = ["active", "completed", "cancelled", "converted"];

export type Outcome = "converted" | "churned" | "no_response";
export const OUTCOMES: readonly Outcome[] = ["converted", "churned", "no_response"];

// ── Account context for enrollment matching ─────────────────────────────────

export interface AccountContext {
  /** Days since last transaction. */
  inactiveDays: number;
  /** Transaction decline percentage (0–100). */
  declinePct: number;
  /** Whether a recent complaint exists for this account. */
  hasRecentComplaint: boolean;
}

// ── shouldEnroll ────────────────────────────────────────────────────────────

/**
 * Match an account's context against active cadences and return the first
 * cadence whose trigger criteria are fully satisfied, or null if none match.
 *
 * A cadence with no trigger criteria never matches (empty criteria = misconfigured,
 * not "matches everything").
 */
export function shouldEnroll(
  account: AccountContext,
  cadences: Pick<WinbackCadenceView, "id" | "triggerCriteria" | "status">[],
): string | null {
  for (const cadence of cadences) {
    if (cadence.status !== "active") continue;
    if (matchesCriteria(account, cadence.triggerCriteria)) {
      return cadence.id;
    }
  }
  return null;
}

/**
 * Check whether an account context satisfies all specified trigger criteria.
 * Each present criterion must be met; absent criteria are not checked.
 * If no criteria are specified, the cadence does NOT match (fail-safe).
 */
export function matchesCriteria(
  account: AccountContext,
  criteria: TriggerCriteria,
): boolean {
  const checks: boolean[] = [];

  if (criteria.inactiveDays !== undefined) {
    checks.push(account.inactiveDays >= criteria.inactiveDays);
  }
  if (criteria.declinePct !== undefined) {
    checks.push(account.declinePct >= criteria.declinePct);
  }
  if (criteria.hasRecentComplaint !== undefined) {
    checks.push(account.hasRecentComplaint === criteria.hasRecentComplaint);
  }

  // No criteria specified = no match (fail-safe against misconfigured cadences)
  if (checks.length === 0) return false;

  return checks.every(Boolean);
}

// ── advanceStep ─────────────────────────────────────────────────────────────

export interface AdvanceResult {
  completed: boolean;
  nextStep?: number;
  scheduledAction?: CadenceStep;
}

/**
 * Advance an enrollment to the next step in its cadence.
 * Returns either the next step info or signals that the cadence is completed.
 *
 * Preconditions (caller must enforce):
 * - enrollment.status === 'active'
 * - the cadence has steps
 */
export function advanceStep(
  currentStep: number,
  steps: CadenceStep[],
): AdvanceResult {
  const nextOrdinal = currentStep + 1;

  // Steps are 0-indexed internally; if nextOrdinal exceeds the count, cadence is done
  if (nextOrdinal >= steps.length) {
    return { completed: true };
  }

  const step = steps[nextOrdinal];
  if (!step) {
    return { completed: true };
  }

  return {
    completed: false,
    nextStep: nextOrdinal,
    scheduledAction: step,
  };
}

// ── canCancel ───────────────────────────────────────────────────────────────

/**
 * Only active enrollments can be cancelled. Completed, already-cancelled,
 * or converted enrollments are immutable.
 */
export function canCancel(status: string): boolean {
  return status === "active";
}

// ── recordOutcome ───────────────────────────────────────────────────────────

/**
 * Validate and apply an outcome to an enrollment.
 * Returns the terminal status implied by the outcome.
 *
 * Rules:
 * - Only active enrollments can receive an outcome.
 * - "converted" sets status to "converted" and records convertedAt.
 * - "churned" and "no_response" set status to "completed".
 */
export function recordOutcome(
  enrollmentStatus: string,
  outcome: Outcome,
): { valid: true; newStatus: EnrollmentStatus } | { valid: false; reason: string } {
  if (enrollmentStatus !== "active") {
    return { valid: false, reason: "Only active enrollments can receive an outcome" };
  }

  if (!OUTCOMES.includes(outcome)) {
    return { valid: false, reason: `Invalid outcome: ${outcome}` };
  }

  if (outcome === "converted") {
    return { valid: true, newStatus: "converted" };
  }

  // churned or no_response → completed (cadence ran its course with a known result)
  return { valid: true, newStatus: "completed" };
}

// ── Validation helpers ──────────────────────────────────────────────────────

/**
 * Validate cadence steps array: ordinals must be sequential starting at 0,
 * delayDays must be non-negative, actionType must be non-empty.
 */
export function validateSteps(steps: CadenceStep[]): { valid: true } | { valid: false; reason: string } {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    if (step.ordinal !== i) {
      return { valid: false, reason: `Step ordinal mismatch: expected ${i}, got ${step.ordinal}` };
    }
    if (step.delayDays < 0) {
      return { valid: false, reason: `Step ${i} has negative delayDays` };
    }
    if (!step.actionType || step.actionType.trim().length === 0) {
      return { valid: false, reason: `Step ${i} has empty actionType` };
    }
  }
  return { valid: true };
}

/**
 * Validate trigger criteria: at least one criterion must be specified,
 * numeric values must be non-negative.
 */
export function validateTriggerCriteria(
  criteria: TriggerCriteria,
): { valid: true } | { valid: false; reason: string } {
  const hasAnyCriteria =
    criteria.inactiveDays !== undefined ||
    criteria.declinePct !== undefined ||
    criteria.hasRecentComplaint !== undefined;

  if (!hasAnyCriteria) {
    return { valid: false, reason: "At least one trigger criterion must be specified" };
  }

  if (criteria.inactiveDays !== undefined && criteria.inactiveDays < 0) {
    return { valid: false, reason: "inactiveDays must be non-negative" };
  }
  if (criteria.declinePct !== undefined && (criteria.declinePct < 0 || criteria.declinePct > 100)) {
    return { valid: false, reason: "declinePct must be between 0 and 100" };
  }

  return { valid: true };
}
