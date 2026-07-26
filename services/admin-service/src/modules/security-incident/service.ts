/**
 * CAP-090 — pure domain logic for security incident & breach management.
 * No I/O here so it is trivially unit-testable and reused by routes + workers.
 */

export type IncidentStatus = "detected" | "triaged" | "contained" | "resolved" | "closed";
export type BreachAuthority = "data_protection_board" | "data_principals";

/** Legal lifecycle: forward-only through the ordered states. */
export const INCIDENT_ORDER: IncidentStatus[] = ["detected", "triaged", "contained", "resolved", "closed"];

const ALLOWED: Record<IncidentStatus, IncidentStatus[]> = {
  detected:  ["triaged"],
  triaged:   ["contained"],
  contained: ["resolved"],
  resolved:  ["closed"],
  closed:    [],
};

/** True when `to` is a legal next state from `from`. */
export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

/**
 * Statutory breach-notification deadline (DPDP §8(6) + Draft DPDP Rules 2025).
 * Notification to the Data Protection Board / affected Data Principals is due
 * within `windowHours` of becoming aware of the breach (default 72h).
 */
export function computeBreachDeadline(detectedAt: Date, windowHours = 72): Date {
  if (!Number.isFinite(windowHours) || windowHours <= 0) {
    throw new Error("windowHours must be a positive number");
  }
  return new Date(detectedAt.getTime() + windowHours * 3_600_000);
}

/** A pending notification is overdue once `now` passes its deadline. */
export function isBreachOverdue(deadlineAt: Date, status: string, now = new Date()): boolean {
  return status === "pending" && now.getTime() > deadlineAt.getTime();
}

/** Whole hours remaining until the deadline (negative once overdue). */
export function hoursUntilDeadline(deadlineAt: Date, now = new Date()): number {
  return Math.floor((deadlineAt.getTime() - now.getTime()) / 3_600_000);
}

/** Timestamp column set when a status is first reached. */
export function timestampColumnFor(to: IncidentStatus): string | null {
  switch (to) {
    case "triaged":   return "triagedAt";
    case "contained": return "containedAt";
    case "resolved":  return "resolvedAt";
    case "closed":    return "closedAt";
    default:          return null;
  }
}

/**
 * Maker-checker on close: the actor who closes an incident MUST differ from the
 * actor who reported it (segregation of duties). Returns an error message or
 * null when the pair is acceptable.
 */
export function checkCloseSegregation(reportedBy: string, closingActor: string): string | null {
  return reportedBy === closingActor
    ? "maker-checker: the incident reporter cannot close their own incident"
    : null;
}

/** Domain event topic for a status transition. */
export function eventTopicForStatus(to: IncidentStatus): string {
  return `security.incident.${to}`;
}
