/**
 * Job publication & career portal domain (pure). The application-open gate
 * (status + published + closing deadline, R-RA-0069) and the corrigendum action
 * vocabulary (R-RA-0068). `now` is passed in — no Date.now here.
 */

export interface VacancyView {
  status: string;
  // Should always be a real boolean off the Drizzle `boolean` column, but a
  // raw/serialised read (e.g. JSON round-trip) can hand this back as the
  // STRING "true"/"false" — which is truthy in JS either way, so a bare
  // `!v.isPublished` silently treats an unpublished vacancy as published.
  // Accept both shapes and normalise via isPublishedTrue() below.
  isPublished: boolean | string;
  applicationDeadline?: string | Date | null; // precise closing datetime
}

/** Milliseconds for a deadline value (ISO string or Date), or null. */
function deadlineMs(d: string | Date | null | undefined): number | null {
  if (!d) return null;
  const t = d instanceof Date ? d.getTime() : Date.parse(d);
  return Number.isNaN(t) ? null : t;
}

/** Normalises a possibly-stringified boolean (see VacancyView.isPublished). */
function isPublishedTrue(isPublished: boolean | string): boolean {
  return isPublished === true || isPublished === "true";
}

/**
 * May a candidate apply right now? Requires an OPEN, PUBLISHED vacancy whose
 * closing deadline (if set) has not passed. After the deadline the only way to
 * accept applications is an authorised extension (which pushes the deadline out).
 */
export function isApplicationOpen(v: VacancyView, nowMs: number, requirePublished = true): boolean {
  if (v.status !== "open") return false;
  if (requirePublished && !isPublishedTrue(v.isPublished)) return false;
  const dl = deadlineMs(v.applicationDeadline ?? null);
  return dl === null || nowMs <= dl;
}

/** Reason an application is refused, for a clear candidate-facing message. */
export function applicationClosedReason(v: VacancyView, nowMs: number): string {
  if (v.status === "cancelled") return "this vacancy has been cancelled";
  if (v.status !== "open" || !isPublishedTrue(v.isPublished)) return "this vacancy is not accepting applications";
  const dl = deadlineMs(v.applicationDeadline ?? null);
  if (dl !== null && nowMs > dl) return "the application deadline has passed";
  return "this vacancy is not accepting applications";
}

export const CORRIGENDUM_ACTIONS = ["corrigendum", "extension", "cancellation"] as const;
export type CorrigendumAction = (typeof CORRIGENDUM_ACTIONS)[number];
