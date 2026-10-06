/** court feature — small shared display helpers. */

import { istDatePart, todayIST } from "@/lib/formatters";

/** IST-friendly date-time, e.g. "12 Jul 2026, 14:32". Falls back to "—". */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    // GAP-COURT-HEARINGS-04: pin to IST so a hearing instant renders the same
    // calendar day/time for a UTC-clock server and an IST browser alike.
    timeZone: "Asia/Kolkata",
  });
}

/** Calendar date only, e.g. "12 Jul 2026". Falls back to "—". */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // Bare "YYYY-MM-DD" calendar dates name a day and must NOT be shifted by a
  // timezone (that could roll them to the previous day); only resolve a full
  // instant to its IST day. Mirrors lib/formatters' isBareCalendarDate rule.
  const isBareDate = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(isBareDate ? { timeZone: "UTC" } : { timeZone: "Asia/Kolkata" }),
  });
}

/** Title-case a snake/kebab enum token, e.g. "part_heard" → "Part heard". */
export function humanize(token: string | null | undefined): string {
  if (!token) return "—";
  const s = token.replace(/[_-]+/g, " ").trim();
  return s.length === 0 ? "—" : s.charAt(0).toUpperCase() + s.slice(1);
}

/** Present a stored CNR (16 alnum) as DLHC-01-000123-4 style groups for reading. */
export function fmtCnr(cnr: string | null | undefined): string {
  if (!cnr) return "—";
  return cnr;
}

/** Maps a case status onto a StatusPill variant token the ds kit understands. */
export function casePillStatus(status: string): string {
  switch (status) {
    case "disposed":
      return "completed";
    case "reserved":
    case "part_heard":
    case "pending":
      return "in progress";
    case "registered":
    case "admitted":
      return "open";
    case "appealed":
      return "review";
    default:
      return status; // filed → mut
  }
}

/** Maps an order issuance status onto a StatusPill variant token. */
export function orderPillStatus(status: string): string {
  switch (status) {
    case "issued":
      return "approved";
    case "pending_approval":
      return "submitted";
    case "recalled":
      return "rejected";
    default:
      return "draft";
  }
}

/** Maps a certified-copy status onto a StatusPill variant token. */
export function copyPillStatus(status: string): string {
  switch (status) {
    case "issued":
      return "completed";
    case "fee_paid":
    case "prepared":
      return "in progress";
    case "rejected":
      return "rejected";
    default:
      return "open"; // requested
  }
}

/** Maps a hearing status onto a StatusPill variant token. */
export function hearingPillStatus(status: string): string {
  switch (status) {
    case "held":
      return "completed";
    case "adjourned":
      return "pending";
    case "cancelled":
      return "closed";
    default:
      return "open"; // scheduled
  }
}

/**
 * GAP-COURT-HEARINGS-05: a FIXED hearing-status label dictionary rather than a
 * generic humanize(), so the vocabulary (scheduled/held/adjourned/cancelled) is
 * a stable, translatable set rather than whatever humanize() derives from the
 * raw token. Unknown values fall back to humanize() so nothing disappears.
 */
const HEARING_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  held: "Held",
  adjourned: "Adjourned",
  cancelled: "Cancelled",
};
export function hearingStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return HEARING_STATUS_LABELS[status] ?? humanize(status);
}

/** Today as YYYY-MM-DD (local) — the default date for cause lists / orders. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * GAP-COURT-CASES-02: is a case past its SLA target and still live? Compares
 * IST calendar DATES (via the shared istDatePart/todayIST helpers) so the
 * answer doesn't flip during the 00:00–05:30 IST window a raw UTC compare
 * gets wrong. A disposed/appealed matter is never "overdue" (its clock has
 * stopped); a missing target is not overdue (nothing to breach).
 */
export function isOverdue(
  targetDisposalDate: string | null | undefined,
  status: string | null | undefined,
): boolean {
  if (!targetDisposalDate) return false;
  if (status === "disposed" || status === "appealed") return false;
  const target = istDatePart(targetDisposalDate);
  if (!target) return false;
  return target < todayIST();
}
