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
  const due = row.slaDueAt ?? computeSlaDueAt(row.priority, row.createdAt);
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
