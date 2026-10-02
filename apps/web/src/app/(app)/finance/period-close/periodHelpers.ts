/**
 * Pure helpers for the period-close cockpit: soft-close period validation and
 * default (GAP-FINANCE-PERIOD-CLOSE-03) and display of the closing actor
 * (GAP-FINANCE-PERIOD-CLOSE-06).
 */

// YYYY-MM with a valid month (01-12).
export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** How far from the current month a first-time soft-close period may be (policy values; see PR VERIFY). */
export const MAX_FUTURE_MONTHS = 12;
export const MAX_PAST_MONTHS = 24;

/** Months since year 0 for a "YYYY-MM" string (caller has already checked PERIOD_PATTERN). */
function monthIndex(period: string): number {
  const [y, m] = period.split("-");
  return Number(y) * 12 + (Number(m) - 1);
}

/** "YYYY-MM" for the given "YYYY-MM-DD" (or full ISO) day. */
export function monthOf(isoDay: string): string {
  return isoDay.slice(0, 7);
}

/** Month `delta` months away from "YYYY-MM". */
export function shiftMonth(period: string, delta: number): string {
  const idx = monthIndex(period) + delta;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

/** Inclusive picker bounds for `today` ("YYYY-MM-DD", IST). */
export function periodBounds(todayIso: string): { min: string; max: string } {
  const current = monthOf(todayIso);
  return { min: shiftMonth(current, -MAX_PAST_MONTHS), max: shiftMonth(current, MAX_FUTURE_MONTHS) };
}

/** Error message for a soft-close period, or null when it is a plausible real month. */
export function validatePeriod(period: string, todayIso: string): string | null {
  const p = period.trim();
  if (!PERIOD_PATTERN.test(p)) return "Pick a valid month, e.g. 2026-04 (YYYY-MM).";
  const { min, max } = periodBounds(todayIso);
  if (p > max) return `Period ${p} is more than ${MAX_FUTURE_MONTHS} months ahead. Pick a month up to ${max}.`;
  if (p < min) return `Period ${p} is more than ${MAX_PAST_MONTHS} months back. Pick a month from ${min} onward.`;
  return null;
}

/**
 * The period to pre-fill: the earliest tracked period that is still open (a
 * reopened period waiting to be closed again), else the month after the latest
 * closed period; "" when nothing sensible falls inside the allowed range.
 */
export function suggestPeriod(
  periods: ReadonlyArray<{ period: string; status: string }>,
  todayIso: string,
): string {
  const valid = periods.filter((p) => PERIOD_PATTERN.test(p.period));
  const open = valid.filter((p) => p.status === "open").map((p) => p.period).sort();
  const closed = valid.filter((p) => p.status !== "open").map((p) => p.period).sort();
  const candidate = open[0] ?? (closed.length > 0 ? shiftMonth(closed[closed.length - 1]!, 1) : "");
  return candidate && validatePeriod(candidate, todayIso) === null ? candidate : "";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Closed By" cell. The API returns the actor's user id; a raw UUID is noise to
 * a clerk, so it is shortened to "User 1a2b3c4d" (the full id stays in the cell's
 * title for support). A real name / non-UUID value is shown as-is.
 */
export function formatClosedBy(closedBy: string | null | undefined): { text: string; title?: string } {
  if (!closedBy) return { text: "—" };
  if (UUID_RE.test(closedBy)) return { text: `User ${closedBy.slice(0, 8)}`, title: closedBy };
  return { text: closedBy };
}
