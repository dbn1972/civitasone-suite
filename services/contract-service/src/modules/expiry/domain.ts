import { createHash } from "node:crypto";

/**
 * Days-before-expiry on which a contract.expiry.alert is raised. Same schedule
 * the HRMS contract-expiry detector uses (90/60/30/15/7) plus a final 1-day
 * warning. The sweeper only fires on an EXACT milestone day, so a repeat tick on
 * the same day is a deterministic-messageId duplicate that the inbox absorbs
 * (inbox retention is days, far longer than one day).
 */
export const EXPIRY_MILESTONES = [90, 60, 30, 15, 7, 1] as const;

/** System actor for sweeper-originated commands and the audit trail. */
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Deterministic UUID per (contract, expiry date, milestone): the queue envelope
 * needs a valid UUID and markProcessed must dedupe the same milestone across
 * ticks. An amended expiry date yields a new id, so the new date alerts afresh.
 */
export function expiryMessageId(contractId: string, expiry: string, milestoneDays: number): string {
  const h = createHash("sha1").update(`expiry:${contractId}:${expiry}:${milestoneDays}`).digest("hex");
  const v = h.slice(0, 32).split("");
  v[12] = "5";
  v[16] = ((parseInt(v[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = v.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/** Whole days from `today` to `expiry` (both YYYY-MM-DD, UTC). */
export function daysUntil(expiry: string, today: string): number {
  return Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function isMilestone(days: number): days is (typeof EXPIRY_MILESTONES)[number] {
  return (EXPIRY_MILESTONES as readonly number[]).includes(days);
}
