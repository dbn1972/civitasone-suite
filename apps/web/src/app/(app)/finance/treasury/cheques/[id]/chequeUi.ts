import { formatIndianDate, humanizeStatus } from "@/lib/formatters";
import { actorLabel } from "@/lib/finance/workflowTypes";
import type { FinanceInstrumentSummary } from "@civitasone/types";

/**
 * Presentation helpers for the cheque / DD detail page, kept pure so the rules
 * are unit-tested (GAP-FINANCE-TREASURY-CHEQUES-DETAIL-04 / -06).
 */

/**
 * Roles finance-service admits on the instrument transition routes
 * (FINANCE_ROLES in the instruments module routes). audit_officer may read a
 * cheque but not act on it. The server stays the authority; this only avoids
 * offering a button that would 403. An empty list (no role claim) does not hide
 * the control, matching lib/finance/writeRoles.canWrite.
 */
export const INSTRUMENT_WRITE_ROLES = ["finance_officer", "finance_admin", "super_admin"] as const;

/**
 * finance-service cancelInstrument only moves an instrument out of "issued"
 * (the guard is `transition(..., ["issued"], "cancelled")`); a presented,
 * cleared or bounced instrument answers 409 ILLEGAL_TRANSITION. The control is
 * therefore offered for "issued" only (with a mandatory reason).
 */
export function canCancelInstrument(status: string | null | undefined): boolean {
  return (status ?? "").trim().toLowerCase() === "issued";
}

/** bounced -> presented again (finance-service /represent); mandatory reason. */
export function canRepresentInstrument(status: string | null | undefined): boolean {
  return (status ?? "").trim().toLowerCase() === "bounced";
}

/**
 * issued -> stale, only once the instrument is past its validity horizon (finance-service
 * /stale refuses earlier with 409 INSTRUMENT_NOT_STALE). `validUntil` is the last valid day
 * (ISO date) the detail route returns; `today` is an ISO date (UTC), injected so this is pure.
 */
export function canMarkStale(status: string | null | undefined, validUntil: string | null | undefined, today: string): boolean {
  return (status ?? "").trim().toLowerCase() === "issued" && !!validUntil && today > validUntil.slice(0, 10);
}

/** Masked account label from the last four digits the API returns; "—" when there is no linked account. */
export function maskedAccountLabel(last4: string | null | undefined): string {
  const v = (last4 ?? "").trim();
  return v.length >= 4 ? `XXXXXXXX${v.slice(-4)}` : "—";
}

/** Today's date in India (UTC+05:30), as ISO: the validity horizon is a calendar-day rule in IST. */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** True when the timeline has at least one step to draw (kept out of page.tsx: the empty-vs-error guard). */
export function hasTimelineRows(t: { rows: readonly unknown[] }): boolean {
  return t.rows.length > 0;
}

export type TimelineEntry = { at: string; date: string; event: string; actor: string | null };

/**
 * Clearance timeline from the instrument's real lifecycle timestamps and actors
 * (GAP-FINANCE-TREASURY-CHEQUES-DETAIL-03). An actor is shown ONLY when the API supplied an
 * explicit actor id for that step (rows from before per-step actors were stored, and steps with no
 * actor, show none: a wrong actor in a financial trail is worse than a blank). The actor column is
 * hidden altogether when no row has one.
 */
export function buildChequeTimeline(
  c: FinanceInstrumentSummary,
  names: Record<string, string>,
): { rows: TimelineEntry[]; showActor: boolean } {
  const who = (id: string | null | undefined) => (id ? actorLabel(id, names) : null);
  const rows: TimelineEntry[] = [];
  const push = (at: string | null | undefined, event: string, actorId: string | null | undefined) => {
    if (at) rows.push({ at, date: formatIndianDate(at), event, actor: who(actorId) });
  };
  push(c.issueDate, "Instrument issued", c.issuedBy);
  push(c.presentedAt, "Presented at bank", c.presentedBy);
  push(c.bouncedAt, c.bounceReason ? `Bounced — ${c.bounceReason}` : "Bounced", c.bouncedBy);
  push(c.lastRepresentedAt, c.representReason ? `Presented again — ${c.representReason}` : "Presented again", c.lastRepresentedBy);
  push(c.clearedAt, "Cleared by bank", c.clearedBy);
  push(c.cancelledAt, c.cancelReason ? `Cancelled — ${c.cancelReason}` : "Cancelled", c.cancelledBy);
  push(c.staledAt, "Marked stale", c.staledBy);
  // Chronological; the issue date (a bare date) sorts before any same-day timestamp.
  rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return { rows, showActor: rows.some((r) => r.actor !== null) };
}

const STATUS_ICONS: Record<string, string> = {
  cleared: "✅",
  presented: "⏳",
  bounced: "❌",
  cancelled: "⛔",
  stale: "⌛",
};

/** Icon for the Status stat card: one per lifecycle state, a neutral note otherwise. */
export function chequeStatusIcon(status: string | null | undefined): string {
  return STATUS_ICONS[(status ?? "").trim().toLowerCase()] ?? "📝";
}

/** Humanised status for display ("bounced" -> "Bounced"); "—" when absent. */
export function chequeStatusLabel(status: string | null | undefined): string {
  return status && status.trim() !== "" ? humanizeStatus(status) : "—";
}

/**
 * Cleared Date text. A cheque that has not cleared has no clearedAt; saying
 * "Not cleared" is clearer than a bare dash, but only for the states where it is
 * an expected absence (issued/presented/bounced/cancelled).
 */
export function clearedDateLabel(clearedAt: string | null | undefined, status: string | null | undefined): string {
  if (clearedAt) return formatIndianDate(clearedAt);
  return (status ?? "").trim().toLowerCase() === "cleared" ? "—" : "Not cleared";
}
