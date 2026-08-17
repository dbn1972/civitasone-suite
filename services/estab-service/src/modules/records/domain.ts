/**
 * CSMOP / Record Retention Schedule (Public Records Act) — pure domain logic.
 *
 * Record categories and their statutory retention periods. Category A is
 * permanent (kept forever, never weeded out); B–E age out after a fixed number
 * of years, after which a weed-out (destruction) may be proposed and approved.
 */

export class DomainError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export const RECORD_CATEGORIES = ["A", "B", "C", "D", "E"] as const;
export type RecordCategory = (typeof RECORD_CATEGORIES)[number];

/** Statutory retention in years per category. `null` = permanent (Category A). */
export const RETENTION_YEARS: Record<RecordCategory, number | null> = {
  A: null, // permanent — keep forever, never weeded
  B: 10,
  C: 5,
  D: 3,
  E: 1,
};

export const WEEDOUT_STATUSES = ["proposed", "approved", "rejected", "destroyed"] as const;
export type WeedoutStatus = (typeof WEEDOUT_STATUSES)[number];

export function assertValidCategory(v: string): asserts v is RecordCategory {
  if (!(RECORD_CATEGORIES as readonly string[]).includes(v)) {
    throw new DomainError("INVALID_CATEGORY", `record_category must be one of: ${RECORD_CATEGORIES.join(", ")}`);
  }
}

/**
 * Derive the CSMOP record category from the file's security classification
 * (canonical values from `modules/files/domain.ts` FILE_CLASSIFICATIONS:
 * `top_secret` | `secret` | `confidential` | `public`, matched
 * case-insensitively). `fileType` (CSMOP file-type taxonomy — main / part /
 * volume / linked / standing_guard / ephemeral) is accepted for signature
 * parity with the requirement and reserved for future taxonomy-based
 * overrides, but the current statutory mapping (docs/specs/
 * estab-inv-int-go-live/requirements.md §1.4) is driven solely by
 * classification: Top Secret → A (permanent), Secret → B, Confidential → C,
 * anything else (public / restricted / unclassified / unrecognised) → D
 * (general).
 */
export function getRecordCategory(fileType: string, classificationLevel: string): RecordCategory {
  void fileType;
  switch (classificationLevel.trim().toLowerCase()) {
    case "top_secret":
    case "top secret":
      return "A";
    case "secret":
      return "B";
    case "confidential":
      return "C";
    default:
      return "D";
  }
}

/**
 * Review-due date = fromDate + retention_years (whole years). Returns `null`
 * for Category A (permanent records are never review-due / weedable).
 */
export function computeReviewDueDate(category: RecordCategory, fromDate: Date): Date | null {
  const years = RETENTION_YEARS[category];
  if (years === null) return null;
  const due = new Date(fromDate);
  due.setFullYear(due.getFullYear() + years);
  return due;
}

/**
 * Guard executed at the weed-out APPROVE step. A record may only be approved for
 * destruction when it is past its statutory review-due date AND is not a
 * permanent (Category A) record.
 */
export function assertWeedable(
  category: RecordCategory,
  reviewDueDate: Date | null,
  now: Date,
): void {
  if (category === "A") {
    throw new DomainError("PERMANENT_RECORD", "Category A records are permanent and can never be weeded out");
  }
  if (reviewDueDate === null) {
    throw new DomainError("NO_REVIEW_DATE", "record has no review-due date; cannot weed out");
  }
  if (now.getTime() < reviewDueDate.getTime()) {
    throw new DomainError("RETENTION_NOT_ELAPSED", "cannot destroy before the review-due date has elapsed");
  }
}

/** True once a disposal action has been recorded against the record. */
export function isDisposalRecorded(record: { disposalAction?: string | null; disposedAt?: Date | string | null } | null | undefined): boolean {
  if (!record) return false;
  return record.disposalAction != null && record.disposalAction !== "" && record.disposedAt != null;
}

/** Format a Date as a Postgres `date` literal (YYYY-MM-DD). */
export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}
