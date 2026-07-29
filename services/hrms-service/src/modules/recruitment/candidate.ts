/**
 * Candidate identity & profile domain (pure). Identity normalisation for
 * duplicate detection (R-RA-0080), the fields locked after submission
 * (R-RA-0089), consent capture requirements (R-RA-0090), and a simple profile
 * completeness score. No I/O.
 */

/** Lower-cased, trimmed email for duplicate matching. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Last 10 digits of a mobile number (strips spaces, +, country code noise). */
export function normalizeMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * A mobile is only a valid DUPLICATE key when it normalises to exactly 10 digits.
 * Garbage / placeholder input ("N/A", "-", short numbers) returns null so it is
 * NOT stored as a dedup key and cannot false-positive-collide two unrelated
 * candidates (the partial unique index also excludes NULL).
 */
export function mobileDedupKey(mobile: string | undefined | null): string | null {
  if (!mobile) return null;
  const n = normalizeMobile(mobile);
  return n.length === 10 ? n : null;
}

export const CATEGORIES = ["GEN", "OBC", "SC", "ST", "EWS"] as const;

/**
 * Fields that are LOCKED once a candidate submits their profile (R-RA-0089):
 * the eligibility-critical identity/reservation attributes cannot be changed
 * after submission (they drive age relaxation, reservation and eligibility).
 * Contact/address remain editable so a candidate can be reached.
 */
export const LOCKED_AFTER_SUBMIT = [
  "fullName", "dateOfBirth", "gender", "category", "subCategory",
  "disability", "exServiceman", "nationality", "guardianName",
] as const;

export function isFieldLocked(status: string, field: string): boolean {
  return status !== "draft" && (LOCKED_AFTER_SUBMIT as readonly string[]).includes(field);
}

/** Which of the requested edit fields are locked given the current status. */
export function lockedFieldsIn(status: string, fields: string[]): string[] {
  return fields.filter((f) => isFieldLocked(status, f));
}

export interface ConsentInput { consentVersion?: string | undefined; consentAccepted?: boolean | undefined; }
/** A profile may only be submitted with an explicit, versioned consent (R-RA-0090). */
export function consentSatisfied(c: ConsentInput): boolean {
  return c.consentAccepted === true && typeof c.consentVersion === "string" && c.consentVersion.length > 0;
}

export interface CompletenessInput {
  fullName?: unknown; dateOfBirth?: unknown; email?: unknown; mobile?: unknown;
  category?: unknown; educationCount: number; employmentCount: number; activeResume?: unknown;
}
/** 0-100 profile completeness for the candidate dashboard. */
export function profileCompleteness(i: CompletenessInput): number {
  const checks = [
    !!i.fullName, !!i.dateOfBirth, !!i.email, !!i.mobile, !!i.category,
    i.educationCount > 0, i.employmentCount > 0, !!i.activeResume,
  ];
  const done = checks.filter(Boolean).length;
  return Math.round((done / checks.length) * 100);
}
