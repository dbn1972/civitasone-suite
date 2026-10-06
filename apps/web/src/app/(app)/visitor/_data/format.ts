/** visitor feature — small shared display helpers. */

/**
 * GAP-VISITOR-HOME-03: all day-boundary and clock rendering is pinned to the
 * tenant premises timezone (IST) rather than the Node server-process clock.
 * On a UTC host the civil day rolls at 05:30 IST, so a server-local day
 * comparison mis-counts evening/early-morning visits and SSR vs. browser
 * renders could disagree. Passing an explicit `timeZone` to every formatter
 * makes the output deterministic regardless of where the process runs.
 */
const IST = "Asia/Kolkata";

/** The civil calendar day ("YYYY-MM-DD") of an instant, as seen in `timeZone`. */
function dayInZone(d: Date, timeZone: string): string {
  // en-CA renders ISO-ordered "YYYY-MM-DD", so string compares are date compares.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** IST short time, e.g. "14:32". Falls back to "—" on bad input. */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: IST });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: IST,
  });
}

/**
 * True when `iso` falls on the same IST civil day as `now` (default: real now).
 * `now` is injectable so a test can pin "today" without mocking the clock.
 */
export function isToday(iso: string | null | undefined, now: Date = new Date()): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return dayInZone(d, IST) === dayInZone(now, IST);
}

/**
 * True when `iso` is on or after the start of the current IST civil day — i.e.
 * "today or later" in IST. Used to scope "upcoming" counts (GAP-VISITOR-HOME-04).
 * `now` is injectable for tests.
 */
export function isTodayOrLater(iso: string | null | undefined, now: Date = new Date()): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return dayInZone(d, IST) >= dayInZone(now, IST);
}

/** Hours a visitor has been on premises since check-in (for overstay flags). */
export function hoursSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / 3_600_000;
}
