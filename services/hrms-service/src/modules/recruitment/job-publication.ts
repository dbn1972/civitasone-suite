/**
 * Job publication & career portal domain (pure). The application-open gate
 * (status + published + closing deadline, R-RA-0069) and the corrigendum action
 * vocabulary (R-RA-0068). `now` is passed in — no Date.now here.
 */

export interface VacancyView {
  status: string;
  isPublished: string;              // 'true' | 'false' (legacy varchar)
  applicationDeadline?: string | Date | null; // precise closing datetime
}

/** Milliseconds for a deadline value (ISO string or Date), or null. */
function deadlineMs(d: string | Date | null | undefined): number | null {
  if (!d) return null;
  const t = d instanceof Date ? d.getTime() : Date.parse(d);
  return Number.isNaN(t) ? null : t;
}

/**
 * May a candidate apply right now? Requires an OPEN, PUBLISHED vacancy whose
 * closing deadline (if set) has not passed. After the deadline the only way to
 * accept applications is an authorised extension (which pushes the deadline out).
 */
export function isApplicationOpen(v: VacancyView, nowMs: number, requirePublished = true): boolean {
  if (v.status !== "open") return false;
  if (requirePublished && v.isPublished !== "true") return false;
  const dl = deadlineMs(v.applicationDeadline ?? null);
  return dl === null || nowMs <= dl;
}

/** Reason an application is refused, for a clear candidate-facing message. */
export function applicationClosedReason(v: VacancyView, nowMs: number): string {
  if (v.status === "cancelled") return "this vacancy has been cancelled";
  if (v.status !== "open" || v.isPublished !== "true") return "this vacancy is not accepting applications";
  const dl = deadlineMs(v.applicationDeadline ?? null);
  if (dl !== null && nowMs > dl) return "the application deadline has passed";
  return "this vacancy is not accepting applications";
}

export const CORRIGENDUM_ACTIONS = ["corrigendum", "extension", "cancellation"] as const;
export type CorrigendumAction = (typeof CORRIGENDUM_ACTIONS)[number];
