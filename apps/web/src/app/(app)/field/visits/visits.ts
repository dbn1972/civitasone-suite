/**
 * Pure helpers for the field visits screen (P1-10).
 * GPS coordinates stay as decimal strings from the service — never coerce to
 * float for distance maths in the UI; formatting only.
 */
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

export function formatCoord(lat: string | null, lon: string | null): string {
  if (lat === null || lon === null || lat === "" || lon === "") return "—";
  return `${lat}, ${lon}`;
}

export function visitStatus(visit: Pick<FieldVisit, "checkOutAt" | "outcome">): "open" | "completed" {
  return visit.checkOutAt ? "completed" : "open";
}

export function outcomeLabel(outcome: string | null): string {
  if (!outcome) return "—";
  return outcome.replace(/_/g, " ");
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
