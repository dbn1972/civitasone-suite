/**
 * Screening & shortlisting domain (pure). Decision vocabulary, structured
 * rejection reasons, the rule that a rejection MUST carry a reason, the
 * auto-screen mapping from a stored eligibility result, and the blind-screening
 * redaction of protected attributes. No I/O.
 */

/** R-RA-0112 screening decisions. */
export const SCREENING_DECISIONS = [
  "pending", "eligible", "ineligible", "shortlisted", "waitlisted", "manual_review",
] as const;
export type ScreeningDecision = (typeof SCREENING_DECISIONS)[number];

/** R-RA-0113 structured rejection reason codes. */
export const REJECTION_REASON_CODES = [
  "eligibility", "skill", "experience", "qualification",
  "incomplete_documents", "duplicate", "position_hold", "other",
] as const;
export type RejectionReasonCode = (typeof REJECTION_REASON_CODES)[number];

export function isScreeningDecision(v: string): v is ScreeningDecision {
  return (SCREENING_DECISIONS as readonly string[]).includes(v);
}
export function isRejectionReasonCode(v: string): v is RejectionReasonCode {
  return (REJECTION_REASON_CODES as readonly string[]).includes(v);
}

/** Decisions that reject a candidate and therefore REQUIRE a structured reason. */
export function requiresRejectionReason(decision: ScreeningDecision): boolean {
  return decision === "ineligible";
}

/** Rules-based auto-screen (R-RA-0106): map the persisted eligibility result to
 *  an eligible / ineligible decision. Applications never evaluated stay pending. */
export function autoScreenDecision(eligibilityResult: { eligible?: boolean } | null | undefined): ScreeningDecision {
  if (!eligibilityResult || typeof eligibilityResult.eligible !== "boolean") return "pending";
  return eligibilityResult.eligible ? "eligible" : "ineligible";
}

/**
 * Protected attributes withheld under blind screening (R-RA-0110) so a reviewer
 * ranks on merit without seeing identity / reservation / demographic fields.
 */
export const PROTECTED_FIELDS = [
  "applicantName", "email", "mobile", "category", "dateOfBirth", "gender",
  // Resume references are withheld too — a resume re-identifies the candidate
  // (name/photo), which would defeat blind review.
  "resumeRef", "resumeFileKey",
] as const;

/** Return a copy of an application row with the protected attributes removed. */
export function redactApplicant<T extends Record<string, unknown>>(row: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!(PROTECTED_FIELDS as readonly string[]).includes(k)) out[k] = v;
  }
  return out as Partial<T>;
}
