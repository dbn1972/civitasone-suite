import { istDatePart, todayIST } from "@/lib/formatters";

/**
 * GAP-DOCUMENTS-INBOX-03: a dak is overdue when its due date is before today
 * (compared in IST calendar days to avoid an off-by-one around midnight) and
 * it has not yet been acknowledged. An acknowledged dak is never flagged.
 */
export function isOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate || status === "acknowledged") return false;
  const due = istDatePart(dueDate);
  if (!due) return false;
  return due < todayIST();
}

/**
 * GAP-DOCUMENTS-INBOX-04: never print a raw user UUID (PII / id leakage). The
 * documents module has no user-name lookup wired in, so until one exists we
 * show a short, non-identifying reference token rather than the full uuid.
 */
export function assigneeLabel(assignedTo: string | null): string {
  if (!assignedTo) return "—";
  const short = assignedTo.replace(/-/g, "").slice(0, 6);
  return short ? `User ${short}` : "—";
}
