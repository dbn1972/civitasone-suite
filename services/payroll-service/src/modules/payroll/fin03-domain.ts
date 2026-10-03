/**
 * fin-payroll-03 gap batch: pure (no I/O) domain helpers.
 *
 *  - pay-group schedule validation + pay-date generation
 *    (GAP-PAYROLL-PAY-GROUPS-01),
 *  - pensioner status transitions (GAP-PAYROLL-PENSIONERS-03),
 *  - display masking for a PPO number (GAP-PAYROLL-PENSIONERS-04),
 *  - salary-revision sanity rules shared by the zod boundary
 *    (GAP-PAYROLL-SALARY-REVISIONS-03),
 *  - the reimbursement attachment key layout (GAP-PAYROLL-REIMBURSEMENTS-03).
 */

import { REIMBURSEMENT_RECEIPT_REQUIRED_CATEGORIES } from "@civitasone/types";

// ─── Pay-group schedule ────────────────────────────────────────────────────

export type PayFrequency = "monthly" | "bi_weekly" | "weekly";

export interface PaySchedule {
  frequency: PayFrequency;
  payDayOfMonth: number;
  /** ISO weekday, 1 (Monday) .. 7 (Sunday). */
  payWeekday?: number | null | undefined;
  /** Monthly only: pay on the last calendar day of the month. */
  payLastDay?: boolean | null | undefined;
  /** Bi-weekly only: 1 = odd ISO weeks, 0 = even ISO weeks. */
  payWeekParity?: number | null | undefined;
}

/**
 * Returns a human-readable problem with the schedule, or null when it is
 * consistent. Legacy groups (a weekly / bi-weekly group stored with only a
 * day-of-month) stay valid: a weekday is optional, but once one is given the
 * combination has to make sense for the frequency.
 */
export function validatePaySchedule(s: PaySchedule): string | null {
  const hasWeekday = s.payWeekday != null;
  const hasParity = s.payWeekParity != null;
  const lastDay = s.payLastDay === true;
  if (s.frequency === "monthly") {
    if (hasWeekday || hasParity) return "a monthly pay group is paid on a day of the month, not on a weekday";
    return null;
  }
  if (lastDay) return "'last day of the month' applies to monthly pay groups only";
  if (s.frequency === "weekly") {
    if (hasParity) return "week parity applies to bi-weekly pay groups only";
    return null;
  }
  // bi_weekly
  if (hasParity && !hasWeekday) return "a bi-weekly pay group needs a weekday as well as the week parity";
  return null;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** ISO-8601 week number (1..53) of a UTC calendar date. */
export function isoWeek(year: number, month: number, day: number): number {
  const d = new Date(Date.UTC(year, month - 1, day));
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

const iso = (y: number, m: number, d: number): string =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * Pay dates (YYYY-MM-DD, ascending) a group pays in the calendar month
 * `month` (1..12) of `year`.
 *  - monthly: the day-of-month clamped to the month's last day (so 31 in
 *    April pays on the 30th), or exactly the last day when payLastDay;
 *  - weekly: every date falling on the pay weekday;
 *  - bi-weekly: those dates whose ISO week has the configured parity;
 *  - weekly / bi-weekly WITHOUT a weekday (legacy rows): the legacy
 *    day-of-month rule, so existing calendars do not move.
 */
export function payDatesForMonth(s: PaySchedule, year: number, month: number): string[] {
  const last = daysInMonth(year, month);
  if (s.frequency === "monthly" || s.payWeekday == null) {
    const day = s.payLastDay === true ? last : Math.min(s.payDayOfMonth, last);
    return [iso(year, month, day)];
  }
  const out: string[] = [];
  for (let day = 1; day <= last; day++) {
    const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
    if (dow !== s.payWeekday) continue;
    if (s.frequency === "bi_weekly" && s.payWeekParity != null && isoWeek(year, month, day) % 2 !== s.payWeekParity) continue;
    out.push(iso(year, month, day));
  }
  return out;
}

// ─── Pensioner status ──────────────────────────────────────────────────────

export type PensionerStatus = "active" | "stopped" | "deceased";

/**
 * active -> stopped | deceased, stopped -> deceased. Deceased is terminal and
 * nothing re-activates a pensioner here (a wrongly-stopped pension is
 * restored by re-registering under the same PPO with a reviewed order).
 */
export function canTransitionPensioner(from: string, to: string): boolean {
  if (from === "active") return to === "stopped" || to === "deceased";
  if (from === "stopped") return to === "deceased";
  return false;
}

/** "PPO/2024/00123" -> "••••0123"; fewer than 4 characters -> "••••". */
export function maskPpoNo(ppo: string | null | undefined): string {
  const v = (ppo ?? "").trim();
  if (!v) return "";
  if (v.length < 4) return "••••";
  return `••••${v.slice(-4)}`;
}

// ─── Salary revisions ──────────────────────────────────────────────────────

export interface RevisionAmounts {
  oldBasicMinor: number;
  newBasicMinor: number;
  oldGrossMinor: number;
  newGrossMinor: number;
  revisionType: string;
}

/** Returns the first rule the revision breaks, as { path, message }, or null. */
export function revisionSanityIssue(r: RevisionAmounts): { path: string; message: string } | null {
  if (r.newGrossMinor < r.newBasicMinor) {
    return { path: "newGrossMinor", message: "new gross pay cannot be below new basic pay" };
  }
  if ((r.oldBasicMinor === 0) !== (r.oldGrossMinor === 0)) {
    return { path: "oldGrossMinor", message: "old basic and old gross must be given together" };
  }
  if (r.oldGrossMinor > 0 && r.oldGrossMinor < r.oldBasicMinor) {
    return { path: "oldGrossMinor", message: "old gross pay cannot be below old basic pay" };
  }
  if (r.revisionType !== "correction" && r.oldBasicMinor > 0 && r.newBasicMinor < r.oldBasicMinor) {
    return { path: "newBasicMinor", message: "new basic pay is below the old basic pay; record a downward change as a correction" };
  }
  return null;
}

// ─── Reimbursement attachments ─────────────────────────────────────────────

export function receiptRequired(category: string): boolean {
  return REIMBURSEMENT_RECEIPT_REQUIRED_CATEGORIES.includes(category);
}

/** The prefix the presign endpoint issues to ONE uploader within a tenant. */
export function reimbursementActorPrefix(tenantId: string, actorId: string): string {
  return `${reimbursementAttachmentPrefix(tenantId)}${actorId}/`;
}

export type ReceiptRuleViolation = "RECEIPT_REQUIRED" | "RECEIPT_KEY_INVALID";

/**
 * Rules for a NEW claim: a receipt-required category needs at least one key,
 * and every key must be one this tenant issued to this submitter
 * (server-generated payroll/<tenant>/reimbursements/<actor>/<uuid>/<name>);
 * anything else is foreign or forged. Existing claims are never re-checked.
 */
export function receiptRuleViolation(
  tenantId: string, actorId: string, category: string, keys: readonly string[] | undefined,
): ReceiptRuleViolation | null {
  const list = keys ?? [];
  if (receiptRequired(category) && list.length === 0) return "RECEIPT_REQUIRED";
  const prefix = reimbursementActorPrefix(tenantId, actorId);
  if (list.some((k) => !k.startsWith(prefix) || k.includes(".."))) return "RECEIPT_KEY_INVALID";
  return null;
}

export const REIMBURSEMENT_ATTACHMENT_MAX = 5;
export const REIMBURSEMENT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const REIMBURSEMENT_ATTACHMENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;

export function reimbursementAttachmentPrefix(tenantId: string): string {
  return `payroll/${tenantId}/reimbursements/`;
}

/** payroll/<tenant>/reimbursements/<actor>/<uuid>/<safe filename> */
export function buildReimbursementAttachmentKey(tenantId: string, actorId: string, uuid: string, filename: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]+/gu, "_").slice(-120) || "receipt";
  return `${reimbursementAttachmentPrefix(tenantId)}${actorId}/${uuid}/${safe}`;
}
