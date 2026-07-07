/**
 * Renewals — pure domain logic.
 *
 * Tracks contract expiry and generates advance notice notifications.
 * - Configurable advance notice: 7–180 calendar days before expiry
 * - Auto-remind at 7 days before expiry if not yet renewed
 */

/** Min and max advance notice days */
export const MIN_ADVANCE_NOTICE_DAYS = 7;
export const MAX_ADVANCE_NOTICE_DAYS = 180;

export interface RenewalNoticeSchedule {
  advanceNoticeDate: string; // ISO date (YYYY-MM-DD)
  finalReminderDate: string; // ISO date — always 7 days before expiry
}

/**
 * Compute notification dates for a renewal.
 *
 * @param expiryDate - Contract expiry date (YYYY-MM-DD)
 * @param advanceNoticeDays - Configurable number of days before expiry (7–180)
 * @returns Object with advanceNoticeDate and finalReminderDate
 */
export function computeRenewalNotices(expiryDate: string, advanceNoticeDays: number): RenewalNoticeSchedule {
  const clamped = Math.max(MIN_ADVANCE_NOTICE_DAYS, Math.min(MAX_ADVANCE_NOTICE_DAYS, advanceNoticeDays));
  const expiry = new Date(expiryDate + "T00:00:00Z");

  const advanceDate = new Date(expiry);
  advanceDate.setUTCDate(advanceDate.getUTCDate() - clamped);

  const finalDate = new Date(expiry);
  finalDate.setUTCDate(finalDate.getUTCDate() - 7);

  return {
    advanceNoticeDate: advanceDate.toISOString().split("T")[0]!,
    finalReminderDate: finalDate.toISOString().split("T")[0]!,
  };
}

/**
 * Determine if a renewal is within its notice window.
 *
 * @param expiryDate - Contract expiry date (YYYY-MM-DD)
 * @param advanceNoticeDays - Advance notice period in days
 * @param today - Current date (YYYY-MM-DD)
 * @returns true if today falls within [expiryDate - advanceNoticeDays, expiryDate]
 */
export function isWithinNoticeWindow(expiryDate: string, advanceNoticeDays: number, today: string): boolean {
  const expiry = new Date(expiryDate + "T00:00:00Z");
  const ref = new Date(today + "T00:00:00Z");
  const clamped = Math.max(MIN_ADVANCE_NOTICE_DAYS, Math.min(MAX_ADVANCE_NOTICE_DAYS, advanceNoticeDays));

  const windowStart = new Date(expiry);
  windowStart.setUTCDate(windowStart.getUTCDate() - clamped);

  return ref >= windowStart && ref <= expiry;
}

/** Valid renewal statuses */
export const RENEWAL_STATUSES = ["active", "renewed", "expired", "cancelled"] as const;
export type RenewalStatus = (typeof RENEWAL_STATUSES)[number];

export class RenewalDomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "RenewalDomainError";
  }
}
