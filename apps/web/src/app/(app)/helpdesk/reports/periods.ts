/**
 * Helpdesk report periods and their labels. A plain module (not the "use client"
 * ReportPeriodNav.tsx): the Server Component page reads PERIOD_LABELS[period],
 * and an object exported from a client module is a client reference on the
 * server, so every heading rendered "Total Tickets (undefined)" (UAT Phase 1B).
 */
export type ReportPeriod = "mtd" | "qtd" | "fy";

export const PERIOD_LABELS: Record<ReportPeriod, string> = {
  mtd: "Month-to-date",
  qtd: "Quarter-to-date",
  fy: "Financial year",
};
