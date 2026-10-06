import { daysUntilIST } from "@/lib/formatters";

/**
 * Single source of truth for estab file SLA/pendency maths
 * (GAP-ESTAB-INBOX-03). Previously the same calculation was duplicated in
 * inbox/page.tsx (server, server timezone) and InboxPanel.tsx (browser,
 * browser timezone), both using local `setHours(0,0,0,0)` — so the same file
 * could show a different "days left" in the server-rendered stat card and the
 * client-rendered SLA pill near midnight or across timezones.
 *
 * Both now delegate to `daysUntilIST`, which computes whole calendar days in
 * Asia/Kolkata regardless of the host timezone, so the stat count and the pill
 * always agree.
 */

/** Whole calendar days until `dueDate` in IST; null when absent/unparseable. */
export function daysLeft(dueDate?: string | null): number | null {
  return daysUntilIST(dueDate);
}

export type SlaTone = "good" | "warn" | "bad" | "mut";
export type Sla = { label: string; tone: SlaTone };

/** SLA pill label + tone for a due date, computed in IST calendar days. */
export function computeSla(dueDate?: string | null): Sla {
  const d = daysLeft(dueDate);
  if (d === null) return { label: "—", tone: "mut" };
  if (d < 0) return { label: `overdue ${Math.abs(d)}d`, tone: "bad" };
  if (d <= 3) return { label: `${d}d left`, tone: "warn" };
  return { label: `${d}d left`, tone: "good" };
}

// GAP-ESTAB-DASHBOARD-01: one SLA definition for inbox, list and dashboard.

/**
 * An estab file is "overdue" when dueDate < today (IST) and its status is
 * neither "archived" nor "disposed" — the same rule the dashboard endpoint
 * uses server-side. All client-side overdue checks should call this.
 */
export function isOverdue(
  file: { dueDate?: string | null; status?: string },
): boolean {
  if (file.status === "archived" || file.status === "disposed") return false;
  const d = daysLeft(file.dueDate);
  return d !== null && d < 0;
}

/**
 * Pendency in whole calendar days (IST) since `createdDate`. Returns null
 * when the date is missing/unparseable or status is closed.
 */
export function pendencyDays(
  file: { createdDate?: string; status?: string },
): number | null {
  if (!file.createdDate || file.createdDate === "—") return null;
  if (file.status === "archived" || file.status === "disposed") return null;
  // daysLeft is "days until due", so for "days since created" we negate.
  const d = daysLeft(file.createdDate);
  return d !== null ? -d : null;
}
