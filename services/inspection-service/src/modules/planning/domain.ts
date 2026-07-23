/**
 * Planning domain — pure functions for plan lifecycle state machine and entity selection.
 *
 * No side effects, no DB access, no I/O. Fully deterministic and property-testable.
 *
 * Plan lifecycle: draft → pending_approval → active
 *
 * _Requirements: 3.4, 3.5, 3.6, 3.7_
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Valid plan states in the lifecycle. */
export const PLAN_STATES = ["draft", "pending_approval", "active"] as const;
export type PlanState = (typeof PLAN_STATES)[number];

/** Allowed transitions from each state. */
export const PLAN_TRANSITIONS: Record<PlanState, PlanState[]> = {
  draft: ["pending_approval"],
  pending_approval: ["active", "draft"],
  active: [],
};

/**
 * Represents a regulated entity candidate for selection into an inspection plan.
 */
export interface EntityCandidate {
  /** Unique identifier for the entity. */
  id: string;
  /** Current risk score (0–100). */
  riskScore: number;
  /** ISO date string of the last inspection, or null if never inspected. */
  lastInspectionDate: string | null;
  /** Risk category of the entity (e.g. "high", "medium", "low"). */
  riskCategory: string;
}

/**
 * Selection criteria used to filter entities for inclusion in an inspection plan.
 */
export interface SelectionCriteria {
  /** Minimum risk score for inclusion. Entities with score >= threshold are selected. */
  riskThreshold?: number;
  /** Maximum number of days since last inspection. Entities exceeding this are selected. */
  maxDaysSinceLastInspection?: number;
  /** Mandatory inspection frequency in days. Entities overdue by this frequency are selected. */
  mandatoryFrequencyDays?: number;
  /** If provided, only entities with these risk categories are considered. */
  riskCategories?: string[];
}

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * Domain-level error for planning violations (invalid transitions, immutability, etc.).
 * Kept separate from HttpError to maintain pure domain boundary.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

// ── Pure Functions ────────────────────────────────────────────────────────────

/**
 * Assert that a plan state transition is valid.
 *
 * @param current - The current state of the plan.
 * @param target - The desired target state.
 * @throws {DomainError} with code `INVALID_PLAN_TRANSITION` if the transition is not allowed.
 *
 * _Validates: Requirements 3.5, 3.7_
 */
export function assertValidPlanTransition(current: PlanState, target: PlanState): void {
  const allowed = PLAN_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    throw new DomainError(
      "INVALID_PLAN_TRANSITION",
      `Cannot transition plan from '${current}' to '${target}'. Allowed transitions: ${allowed.length > 0 ? allowed.join(", ") : "none (terminal state)"}`,
    );
  }
}

/**
 * Assert that a plan is modifiable (must be in draft status).
 *
 * Active and pending_approval plans are immutable with respect to entity selection
 * and schedule modifications.
 *
 * @param status - The current plan status.
 * @throws {DomainError} with code `PLAN_NOT_MODIFIABLE` if status is not "draft".
 *
 * _Validates: Requirements 3.6, 3.7_
 */
export function assertPlanModifiable(status: PlanState): void {
  if (status !== "draft") {
    throw new DomainError(
      "PLAN_NOT_MODIFIABLE",
      `Plan is in '${status}' state and cannot be modified. Only draft plans are editable.`,
    );
  }
}

/**
 * Select entities that match the given selection criteria.
 *
 * An entity is included if it satisfies ANY of the active criteria:
 * - Risk score >= riskThreshold (if specified)
 * - Days since last inspection > maxDaysSinceLastInspection (if specified)
 * - Days since last inspection > mandatoryFrequencyDays (if specified; never-inspected entities always qualify)
 *
 * Additionally, if riskCategories is specified, only entities whose riskCategory
 * is in the list are considered (pre-filter).
 *
 * @param entities - Array of candidate entities with risk scores and inspection history.
 * @param criteria - The selection criteria to apply.
 * @param referenceDate - The reference date for computing days since last inspection (defaults to now).
 * @returns Array of entities that satisfy at least one criterion.
 *
 * _Validates: Requirements 3.4_
 */
export function selectEntitiesByCriteria(
  entities: EntityCandidate[],
  criteria: SelectionCriteria,
  referenceDate?: Date,
): EntityCandidate[] {
  const now = referenceDate ?? new Date();

  // Pre-filter: restrict to specified risk categories if provided
  let candidates = entities;
  if (criteria.riskCategories && criteria.riskCategories.length > 0) {
    const allowedCategories = new Set(criteria.riskCategories);
    candidates = candidates.filter((e) => allowedCategories.has(e.riskCategory));
  }

  // If no selection criteria are active, return all candidates
  const hasThreshold = criteria.riskThreshold !== undefined && criteria.riskThreshold !== null;
  const hasMaxDays = criteria.maxDaysSinceLastInspection !== undefined && criteria.maxDaysSinceLastInspection !== null;
  const hasFrequency = criteria.mandatoryFrequencyDays !== undefined && criteria.mandatoryFrequencyDays !== null;

  if (!hasThreshold && !hasMaxDays && !hasFrequency) {
    return candidates;
  }

  return candidates.filter((entity) => {
    // Check risk threshold
    if (hasThreshold && entity.riskScore >= criteria.riskThreshold!) {
      return true;
    }

    // Compute days since last inspection
    const daysSinceLastInspection = computeDaysSinceInspection(entity.lastInspectionDate, now);

    // Check max days since last inspection
    if (hasMaxDays && daysSinceLastInspection !== null && daysSinceLastInspection > criteria.maxDaysSinceLastInspection!) {
      return true;
    }

    // Check mandatory frequency (never-inspected entities always qualify)
    if (hasFrequency) {
      if (daysSinceLastInspection === null) {
        // Never inspected — always overdue
        return true;
      }
      if (daysSinceLastInspection > criteria.mandatoryFrequencyDays!) {
        return true;
      }
    }

    return false;
  });
}

// ── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * Compute the number of days between a date string and a reference date.
 * Returns null if the date is null (never inspected).
 */
function computeDaysSinceInspection(lastInspectionDate: string | null, referenceDate: Date): number | null {
  if (lastInspectionDate === null) {
    return null;
  }
  const lastDate = new Date(lastInspectionDate);
  const diffMs = referenceDate.getTime() - lastDate.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}
