/**
 * change/calendar — pure, UI-free helpers (GAP-CHANGE-CALENDAR-01 /
 * GAP-CHANGE-CALENDAR-03). The admin-service remains authoritative for
 * actually BLOCKING a schedule into a freeze (domain.ts assertNoFreezeConflict);
 * these helpers only let the calendar SHOW a conflict/state before a user
 * attempts to schedule, so they mirror the server's half-open interval maths.
 */
import type { ChangeFreeze, ChangeRequest } from "./types";

/**
 * Half-open overlap test: [aStart,aEnd) intersects [bStart,bEnd). Mirrors
 * domain.ts windowsOverlap on the server so the UI's "conflicts with freeze"
 * flag agrees with what the server would reject. Adjacent ranges (one ends
 * exactly when the other starts) do NOT overlap. Returns false for any
 * unparseable/missing bound rather than a false positive.
 */
export function rangesOverlap(
  aStart: string | null | undefined,
  aEnd: string | null | undefined,
  bStart: string | null | undefined,
  bEnd: string | null | undefined,
): boolean {
  const as = aStart ? Date.parse(aStart) : NaN;
  const ae = aEnd ? Date.parse(aEnd) : NaN;
  const bs = bStart ? Date.parse(bStart) : NaN;
  const be = bEnd ? Date.parse(bEnd) : NaN;
  if ([as, ae, bs, be].some((n) => Number.isNaN(n))) return false;
  return as < be && bs < ae;
}

/** Every freeze whose window overlaps the change's release window. */
export function freezesConflictingWith(
  change: Pick<ChangeRequest, "windowStart" | "windowEnd">,
  freezes: readonly ChangeFreeze[],
): ChangeFreeze[] {
  if (!change.windowStart || !change.windowEnd) return [];
  return freezes.filter((f) => rangesOverlap(change.windowStart, change.windowEnd, f.startsAt, f.endsAt));
}

export type FreezeState = "upcoming" | "active" | "ended";

/**
 * GAP-CHANGE-CALENDAR-03: a freeze's state relative to `now` so the calendar
 * can label it and default-hide ended freezes (the page's "active change
 * freezes" subtitle previously listed every freeze including long-past ones).
 * An unparseable window is treated as "active" (fail-safe: surface it rather
 * than silently hide a freeze that might still block releases).
 */
export function freezeState(freeze: Pick<ChangeFreeze, "startsAt" | "endsAt">, now: Date = new Date()): FreezeState {
  const start = Date.parse(freeze.startsAt);
  const end = Date.parse(freeze.endsAt);
  const t = now.getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return "active";
  if (t < start) return "upcoming";
  if (t >= end) return "ended";
  return "active";
}
