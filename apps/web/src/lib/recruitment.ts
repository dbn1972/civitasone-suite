/**
 * Recruitment enums mirrored from hrms-service (no shared package exposes them
 * to the web app). Keep in sync with:
 *   - VACANCY_TYPES          services/hrms-service/src/modules/recruitment/validators.ts
 *   - REJECTION_REASON_CODES services/hrms-service/src/modules/recruitment/screening.ts
 */
export const VACANCY_TYPES = ["regular", "internship", "apprenticeship", "volunteership", "contractual", "deputation"] as const;
export type VacancyType = (typeof VACANCY_TYPES)[number];

export function isVacancyType(v: unknown): v is VacancyType {
  return typeof v === "string" && (VACANCY_TYPES as readonly string[]).includes(v);
}

export const REJECTION_REASON_CODES = [
  "eligibility", "skill", "experience", "qualification",
  "incomplete_documents", "duplicate", "position_hold", "other",
] as const;
export type RejectionReasonCode = (typeof REJECTION_REASON_CODES)[number];
