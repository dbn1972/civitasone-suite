import type { PillVariant } from "@/app/_components/ds/StatusPill";

/**
 * Shared, pure SIEM severity/status vocabulary so the KPI tiles (page.tsx) and
 * the table (SiemTable.tsx) agree. Aligned to the REAL admin-service backing
 * store (security-incident): severity is critical|high|medium|low and the
 * incident status lifecycle is detected|triaged|contained|resolved|closed
 * (service.ts INCIDENT_ORDER). GAP-TENANT-ADMIN-SIEM-02/03/06.
 */

export type SiemSeverity = "critical" | "high" | "medium" | "low";

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

/** Sort rank so severity sorts critical > high > medium > low (not alphabetical). */
export function severityRank(severity: string): number {
  return SEVERITY_RANK[severity.toLowerCase()] ?? 0;
}

/**
 * Tone for a severity. GAP-TENANT-ADMIN-SIEM-02: critical and high must be
 * distinguishable. Both use the red "bad" tone, but critical is additionally
 * marked by isCriticalSeverity() (a leading icon + bolder weight at the call
 * site) so the most urgent severity is told apart by more than text alone.
 */
export function severityTone(severity: string): PillVariant {
  const s = severity.toLowerCase();
  if (s === "critical" || s === "high") return "bad";
  if (s === "medium") return "warn";
  return "info";
}

/** True for the single most-urgent severity, rendered with extra emphasis. */
export function isCriticalSeverity(severity: string): boolean {
  return severity.toLowerCase() === "critical";
}

/**
 * The open (still-actionable) incident lifecycle states. Resolved/closed are
 * terminal. GAP-TENANT-ADMIN-SIEM-03: the "Active Alerts" KPI counts these.
 */
export const OPEN_SIEM_STATUSES = ["detected", "triaged", "contained"] as const;

export function isOpenSiemStatus(status: string): boolean {
  return (OPEN_SIEM_STATUSES as readonly string[]).includes(status.toLowerCase());
}

/**
 * Tone for a status. Known lifecycle states get a deliberate tone; an unknown
 * value falls to neutral "mut" (NOT the old amber "warn", which made every
 * unknown look like it needed attention). GAP-TENANT-ADMIN-SIEM-03.
 */
export function statusTone(status: string): PillVariant {
  switch (status.toLowerCase()) {
    case "resolved":
    case "closed":
      return "good";
    case "detected":
      return "bad";
    case "triaged":
    case "contained":
      return "warn";
    default:
      return "mut";
  }
}
