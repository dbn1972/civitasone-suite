/**
 * Pure helpers for the field visits screen (P1-10).
 * GPS coordinates stay as decimal strings from the service — never coerce to
 * float for distance maths in the UI; formatting only.
 */
import { humanizeStatus } from "@/lib/formatters";

export type FieldVisit = {
  id: string;
  taskId: string;
  agentId: string;
  checkInLatitude: string | null;
  checkInLongitude: string | null;
  checkOutLatitude: string | null;
  checkOutLongitude: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  durationMinutes: number | null;
  outcome: string | null;
  notes: string | null;
};

/**
 * GAP-FIELD-VISITS-03 (PII): precise GPS fixes an identifiable field worker's
 * location. Round to this many decimals by default (~110 m at 3 dp) so a
 * coordinate is not pinpoint-accurate on screen or in a CSV export. Full
 * precision stays in the API payload for anyone with a legitimate, audited
 * reason to pull it directly.
 */
export const COORD_DISPLAY_PRECISION = 3;

function roundCoord(value: string, precision: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toFixed(precision);
}

export function formatCoord(
  lat: string | null,
  lon: string | null,
  precision: number = COORD_DISPLAY_PRECISION,
): string {
  if (lat === null || lon === null || lat === "" || lon === "") return "—";
  return `${roundCoord(lat, precision)}, ${roundCoord(lon, precision)}`;
}

export function visitStatus(visit: Pick<FieldVisit, "checkOutAt" | "outcome">): "open" | "completed" {
  return visit.checkOutAt ? "completed" : "open";
}

/**
 * GAP-FIELD-VISITS-02 (STATUS): "open" and "completed" both mapped to the green
 * StatusPill variant, so the one distinction this page ranks by was invisible.
 * Derive a distinct display status per row:
 *  - completed             -> "completed" (good / green)
 *  - open, checked in <12h -> "in progress" (warn / amber)
 *  - open, checked in >12h -> "overdue" (bad / red) — a long-open visit with
 *    no check-out needs attention.
 * The returned words are already StatusPill vocabulary ("in progress"/"overdue"
 * map to warn/bad) so the global "open" mapping is NOT changed (it is shared by
 * other modules).
 */
export const OPEN_VISIT_OVERDUE_HOURS = 12;

export function visitDisplayStatus(
  visit: Pick<FieldVisit, "checkOutAt" | "outcome" | "checkInAt">,
  now: Date = new Date(),
): "completed" | "in progress" | "overdue" {
  if (visit.checkOutAt) return "completed";
  const hours = openVisitHours(visit, now);
  if (hours !== null && hours > OPEN_VISIT_OVERDUE_HOURS) return "overdue";
  return "in progress";
}

/** Whole hours a still-open visit has been open (null for completed / no check-in). */
export function openVisitHours(
  visit: Pick<FieldVisit, "checkOutAt" | "checkInAt">,
  now: Date = new Date(),
): number | null {
  if (visit.checkOutAt || !visit.checkInAt) return null;
  const inMs = new Date(visit.checkInAt).getTime();
  if (Number.isNaN(inMs)) return null;
  const diff = now.getTime() - inMs;
  if (diff < 0) return 0;
  return Math.floor(diff / (1000 * 60 * 60));
}

export function outcomeLabel(outcome: string | null): string {
  if (!outcome) return "—";
  // GAP-FIELD-VISITS-05: title-case snake_case outcomes ("no_show" -> "No Show")
  // instead of only swapping underscores for spaces (which left it lower-case).
  return humanizeStatus(outcome);
}

/** Open visits first, then newest check-in. */
export function rankVisits(visits: FieldVisit[]): FieldVisit[] {
  return [...visits].sort((a, b) => {
    const ao = visitStatus(a) === "open" ? 0 : 1;
    const bo = visitStatus(b) === "open" ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return (b.checkInAt ?? "").localeCompare(a.checkInAt ?? "");
  });
}
