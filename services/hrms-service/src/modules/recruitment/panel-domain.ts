/**
 * Interview panel governance domain (pure). Panel readiness with conflict-of-
 * interest recusal (R-RA-0138) and outcome validation — recommend / waitlist /
 * reject with reason + validity (R-RA-0149/0150). No I/O.
 */

export const PANEL_ROLES = ["chair", "member", "observer", "technical_expert", "domain_expert"] as const;
export const COI_TYPES = ["none", "relative", "known_associate", "financial", "prior_association", "other"] as const;
export const REJECTION_REASONS = ["low_score", "technical_unsuitability", "communication", "behavioural_fit", "withdrawal", "no_show"] as const;
export const OUTCOME_STATUSES = ["recommended", "waitlisted", "rejected"] as const;

export type CoiType = (typeof COI_TYPES)[number];
export type RejectionReason = (typeof REJECTION_REASONS)[number];
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

export interface Panelist {
  memberId: string;
  panelRole: string;
  coiDeclared: boolean;
  coiType: string;
  recused: boolean;
}

/**
 * Panelists who declared a real conflict of interest but have NOT been recused.
 * These must be cleared before the panel can decide an outcome (R-RA-0138).
 */
export function unrecusedConflicts(panelists: readonly Panelist[]): Panelist[] {
  return panelists.filter((p) => p.coiDeclared && p.coiType !== "none" && !p.recused);
}

export interface PanelReadiness {
  ready: boolean;
  hasChair: boolean;
  activeVoters: number;      // non-observer, non-recused members
  unrecusedConflicts: string[];
  reasons: string[];
}

/**
 * Is the panel constituted well enough to record an outcome?
 * Requires a chair, at least one active (non-observer, non-recused) voter, and no
 * unrecused conflicts of interest.
 */
export function panelReadiness(panelists: readonly Panelist[]): PanelReadiness {
  const hasChair = panelists.some((p) => p.panelRole === "chair" && !p.recused);
  const activeVoters = panelists.filter((p) => p.panelRole !== "observer" && !p.recused).length;
  const conflicts = unrecusedConflicts(panelists).map((p) => p.memberId);
  const reasons: string[] = [];
  if (!hasChair) reasons.push("panel has no (non-recused) chair");
  if (activeVoters < 1) reasons.push("panel has no active voting members");
  if (conflicts.length > 0) reasons.push(`${conflicts.length} panelist(s) with an undeclared/unrecused conflict of interest`);
  return { ready: reasons.length === 0, hasChair, activeVoters, unrecusedConflicts: conflicts, reasons };
}

export interface OutcomeInput {
  status: string;
  rejectionReason?: string | null;
  waitlistRank?: number | null;
  validUntil?: string | null;     // ISO date for recommendation/waitlist validity
  nowMs?: number;                 // for validity comparison
}

/** Validation errors for a proposed outcome (empty = valid). */
export function validateOutcome(input: OutcomeInput): string[] {
  const errors: string[] = [];
  if (!(OUTCOME_STATUSES as readonly string[]).includes(input.status)) {
    errors.push(`unknown outcome status "${input.status}"`);
    return errors;
  }
  if (input.status === "rejected") {
    if (!input.rejectionReason || !(REJECTION_REASONS as readonly string[]).includes(input.rejectionReason)) {
      errors.push("a rejection requires a valid rejection_reason");
    }
  } else {
    // recommended | waitlisted -> a validity period is required and must be in the future
    if (!input.validUntil) errors.push("a recommendation/waitlist requires a validity period (validUntil)");
    else {
      const t = Date.parse(input.validUntil);
      if (Number.isNaN(t)) errors.push("validUntil is not a valid date");
      // Validity is stored as a calendar DATE, so compare at day granularity — a
      // time-of-day earlier today must not read as "future" and then persist as a
      // past date. Reject any day strictly before today.
      else if (input.nowMs != null && Math.floor(t / 86_400_000) < Math.floor(input.nowMs / 86_400_000)) {
        errors.push("the validity period must not be in the past");
      }
    }
    if (input.status === "waitlisted") {
      if (input.waitlistRank == null || !Number.isInteger(input.waitlistRank) || input.waitlistRank < 1) {
        errors.push("a waitlist outcome requires a positive integer waitlist_rank");
      }
    }
  }
  return errors;
}
