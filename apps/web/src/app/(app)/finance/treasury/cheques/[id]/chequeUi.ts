import { formatIndianDate, humanizeStatus } from "@/lib/formatters";

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
 * therefore offered for "issued" only. There is no re-present or mark-stale
 * transition in the service.
 */
export function canCancelInstrument(status: string | null | undefined): boolean {
  return (status ?? "").trim().toLowerCase() === "issued";
}

const STATUS_ICONS: Record<string, string> = {
  cleared: "✅",
  presented: "⏳",
  bounced: "❌",
  cancelled: "⛔",
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
