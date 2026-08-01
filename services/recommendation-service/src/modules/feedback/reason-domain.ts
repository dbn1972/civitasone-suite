/**
 * feedback/reason-domain.ts — CR-AI-03 structured rejection reasons. PURE.
 *
 * Added alongside domain.ts (which owns the legacy free-text rule) because
 * CR-AI-03 makes rejection feedback MACHINE-READABLE: an unexplained rejection
 * teaches the model nothing, and a free-text-only rejection cannot be aggregated.
 *
 * The one place free text is still mandatory is reasonCode 'other': 'other' by
 * definition carries no information, so without a description it is the same as
 * no feedback at all. 10 characters is the floor that rules out "n/a" and "-".
 */

export type RejectionReasonCode =
  | "not_relevant"
  | "wrong_timing"
  | "already_purchased"
  | "incorrect_data"
  | "customer_declined"
  | "other";

export const REJECTION_REASON_CODES: readonly RejectionReasonCode[] = [
  "not_relevant",
  "wrong_timing",
  "already_purchased",
  "incorrect_data",
  "customer_declined",
  "other",
];

/** The only code that forces a free-text description. */
export const FREE_TEXT_REQUIRED_CODE: RejectionReasonCode = "other";

/** Minimum useful description length when reasonCode is 'other'. */
export const MIN_REASON_TEXT_LENGTH = 10;

/** Matches the reason_text column (text) but bounded to keep payloads sane. */
export const MAX_REASON_TEXT_LENGTH = 2000;

export function isRejectionReasonCode(value: string): value is RejectionReasonCode {
  return (REJECTION_REASON_CODES as readonly string[]).includes(value);
}

export interface RejectionInput {
  reasonCode: string;
  reasonText?: string | null | undefined;
}

/** A validation failure carrying the HTTP error code the route must return. */
export interface RejectionValidationError {
  code: "REASON_REQUIRED" | "REASON_INVALID";
  message: string;
}

/**
 * Validate a structured rejection. Returns null when valid.
 *
 * `REASON_REQUIRED` is returned both for a missing/unknown reasonCode and for a
 * too-short reasonText under 'other', because from the caller's point of view
 * both mean the same thing: the mandatory reason has not been supplied.
 */
export function validateRejection(input: RejectionInput): RejectionValidationError | null {
  if (typeof input.reasonCode !== "string" || input.reasonCode.trim().length === 0) {
    return { code: "REASON_REQUIRED", message: "reasonCode is required to reject a recommendation" };
  }

  if (!isRejectionReasonCode(input.reasonCode)) {
    return { code: "REASON_INVALID", message: `unknown reasonCode: ${input.reasonCode}` };
  }

  const text = typeof input.reasonText === "string" ? input.reasonText.trim() : "";

  if (text.length > MAX_REASON_TEXT_LENGTH) {
    return {
      code: "REASON_INVALID",
      message: `reasonText must not exceed ${MAX_REASON_TEXT_LENGTH} characters`,
    };
  }

  if (input.reasonCode === FREE_TEXT_REQUIRED_CODE && text.length < MIN_REASON_TEXT_LENGTH) {
    return {
      code: "REASON_REQUIRED",
      message: `reasonText of at least ${MIN_REASON_TEXT_LENGTH} characters is required when reasonCode is '${FREE_TEXT_REQUIRED_CODE}'`,
    };
  }

  return null;
}

/** Normalise reasonText for storage: trimmed, or null when absent/blank. */
export function normaliseReasonText(reasonText?: string | null): string | null {
  if (typeof reasonText !== "string") return null;
  const trimmed = reasonText.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Short human summary stored in the legacy `reason` varchar(500) column so old
 * readers keep working. Truncated to fit the column.
 */
export function summariseRejection(reasonCode: string, reasonText?: string | null): string {
  const text = normaliseReasonText(reasonText);
  const summary = text === null ? reasonCode : `${reasonCode}: ${text}`;
  return summary.slice(0, 500);
}

export interface ReasonCount {
  reasonCode: string;
  count: number;
}

/**
 * Fill in zero rows for reason codes with no rejections and order the result by
 * count DESC then code ASC, so the summary shape is identical on every call
 * regardless of what the database returned.
 */
export function completeRejectionSummary(counts: readonly ReasonCount[]): ReasonCount[] {
  const byCode = new Map<string, number>();
  for (const code of REJECTION_REASON_CODES) byCode.set(code, 0);

  for (const row of counts) {
    const current = byCode.get(row.reasonCode) ?? 0;
    const increment = Number.isFinite(row.count) ? row.count : 0;
    byCode.set(row.reasonCode, current + increment);
  }

  return [...byCode.entries()]
    .map(([reasonCode, count]) => ({ reasonCode, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.reasonCode < b.reasonCode ? -1 : a.reasonCode > b.reasonCode ? 1 : 0;
    });
}
