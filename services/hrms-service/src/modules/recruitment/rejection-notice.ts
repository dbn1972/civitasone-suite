/**
 * Candidate-facing rejection / outcome communication (checklist R-RA-0118) — pure.
 *
 * Internal screening artefacts (numeric scores, ranks, internal remarks, the
 * screener's identity, the raw eligibility computation) must NEVER reach the
 * candidate. This module builds the candidate-facing notice as an ALLOW-LIST
 * projection: only the safe fields below are ever emitted, so an internal field
 * cannot leak even if the caller passes the whole application row in. A per-
 * vacancy policy flag decides whether a high-level reason CATEGORY (never a
 * score) is disclosed for a rejection.
 */
/** Candidate-friendly, score-free labels for each structured rejection reason. */
export const REJECTION_REASON_LABELS: Record<string, string> = {
  eligibility: "You did not meet the essential eligibility criteria for this position.",
  skill: "The required skills for this position were not sufficiently evidenced.",
  experience: "The position's minimum experience requirement was not met.",
  qualification: "The essential educational qualification for this position was not met.",
  incomplete_documents: "The application could not be processed as required documents were incomplete.",
  duplicate: "A duplicate application was received for this position.",
  position_hold: "Recruitment for this position is currently on hold.",
  other: "The application was not taken forward for this position.",
};

/**
 * Fields that are INTERNAL and must never appear in a candidate-facing notice.
 * Used by tests as an explicit contract; the projection is allow-list based so
 * this list is documentation + a guard, not the mechanism.
 */
export const INTERNAL_ONLY_FIELDS = [
  "screeningRemarks", "screenedBy", "screenedAt", "eligibilityResult",
  "screeningReasonCode", "score", "scores", "rank", "version",
] as const;

/** Map an internal screening decision to a neutral candidate-facing outcome. */
export function candidateOutcome(decision: string): "shortlisted" | "not_selected" | "waitlisted" | "under_consideration" | "under_review" {
  switch (decision) {
    case "shortlisted": return "shortlisted";
    case "ineligible": return "not_selected";
    case "waitlisted": return "waitlisted";
    case "eligible":
    case "manual_review": return "under_consideration";
    default: return "under_review"; // pending / unknown
  }
}

export interface NoticeApplicationInput {
  id: string;
  applicantName: string;
  applicationNo?: string | null;
  jobOpeningId: string;
  screeningDecision: string;
  screeningReasonCode?: string | null;
}

export interface RejectionNotice {
  applicationId: string;
  applicationNo: string | null;
  applicantName: string;
  jobOpeningId: string;
  outcome: ReturnType<typeof candidateOutcome>;
  message: string;
  reason?: string; // high-level category label only, and only when policy allows
}

/**
 * Build the candidate-facing notice. `discloseReason` (the vacancy policy flag)
 * gates whether a high-level reason CATEGORY label is included for a rejection —
 * and even then it is the friendly label, never the raw code, remarks or score.
 */
export function buildRejectionNotice(app: NoticeApplicationInput, opts: { discloseReason: boolean }): RejectionNotice {
  const outcome = candidateOutcome(app.screeningDecision);
  const notice: RejectionNotice = {
    applicationId: app.id,
    applicationNo: app.applicationNo ?? null,
    applicantName: app.applicantName,
    jobOpeningId: app.jobOpeningId,
    outcome,
    message: messageFor(outcome),
  };
  if (outcome === "not_selected" && opts.discloseReason) {
    const code = app.screeningReasonCode ?? "other";
    notice.reason = REJECTION_REASON_LABELS[code] ?? REJECTION_REASON_LABELS.other!;
  }
  return notice;
}

function messageFor(outcome: ReturnType<typeof candidateOutcome>): string {
  switch (outcome) {
    case "shortlisted": return "Congratulations — your application has been shortlisted. You will be contacted with the next steps.";
    case "not_selected": return "Thank you for your interest. After careful consideration, your application has not been taken forward for this position.";
    case "waitlisted": return "Your application has been placed on the waitlist. We will contact you should a suitable opportunity arise.";
    case "under_consideration": return "Your application is under consideration. We will contact you with any updates.";
    default: return "Your application has been received and is under review.";
  }
}
