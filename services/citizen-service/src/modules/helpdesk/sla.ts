import type { TicketRow } from "./schema.js";

export type SlaStatus = "within_sla" | "due_soon" | "breached";

const RESOLUTION_HOURS: Record<string, number> = {
  critical: 4,
  high: 8,
  medium: 24,
  low: 48,
};

export function computeSlaDueAt(priority: string, createdAt: Date): Date {
  const hours = RESOLUTION_HOURS[priority.toLowerCase()] ?? 24;
  return new Date(createdAt.getTime() + hours * 60 * 60 * 1000);
}

export function computeSlaStatus(row: TicketRow, now = new Date()): SlaStatus {
  if (row.status === "closed" || row.status === "resolved") return "within_sla";
  // Cache JSON-roundtrips Date columns to ISO strings; coerce so .getTime() is safe.
  const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt as unknown as string);
  const dueRaw = row.slaDueAt ?? computeSlaDueAt(row.priority, createdAt);
  const due = dueRaw instanceof Date ? dueRaw : new Date(dueRaw as unknown as string);
  const msLeft = due.getTime() - now.getTime();
  if (msLeft <= 0) return "breached";
  if (msLeft <= 4 * 60 * 60 * 1000) return "due_soon";
  return "within_sla";
}

export function mapPriority(priority: string): "low" | "medium" | "high" | "critical" {
  const p = priority.toLowerCase();
  if (p === "critical") return "critical";
  if (p === "high") return "high";
  if (p === "low") return "low";
  return "medium";
}

export function mapStatus(status: string): "open" | "in_progress" | "pending" | "resolved" | "closed" {
  const s = status.toLowerCase();
  if (s === "closed") return "closed";
  if (s === "resolved") return "resolved";
  if (s === "in_progress" || s === "assigned") return "in_progress";
  if (s === "pending") return "pending";
  return "open";
}

export type ReportPeriod = "mtd" | "qtd" | "fy";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Start (inclusive, as a UTC instant) of the reporting period containing `now`,
 * on the Indian calendar: month-to-date from the 1st of the month, quarter-to-date
 * from the start of the Indian fiscal quarter (Apr/Jul/Oct/Jan), fiscal-year-to-date
 * from 1 April. Boundaries are midnight IST.
 */
export function periodStart(period: ReportPeriod, now = new Date()): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth(); // 0-based
  let sy = y;
  let sm: number;
  if (period === "mtd") {
    sm = m;
  } else if (period === "fy") {
    sm = 3;
    if (m < 3) sy = y - 1;
  } else {
    // fiscal quarters start in Apr(3), Jul(6), Oct(9), Jan(0)
    sm = m >= 9 ? 9 : m >= 6 ? 6 : m >= 3 ? 3 : 0;
  }
  return new Date(Date.UTC(sy, sm, 1) - IST_OFFSET_MS);
}
