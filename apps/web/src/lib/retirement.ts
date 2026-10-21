/**
 * Shared helpers for the retirement/separation pages.
 *
 * GAP-HR-RETIREMENT-05: the "next 6 months" upcoming-window filter was
 * copy-pasted three times (page.tsx, RetirementCaseWorkspace.tsx,
 * RetirementDashboard.tsx), each parsing `superannuationDate` as a full
 * Date and comparing against `new Date()` (a moment with a time-of-day),
 * so a separation effective TODAY compared less than "now" the instant
 * any time had passed since local midnight and dropped out of the
 * "upcoming" set the same day it became due. Compares date-only strings
 * instead, so today always counts.
 *
 * GAP-HR-RETIREMENT-03: SEPARATION_TYPES is the single source of truth for
 * the lowercase enum the backend actually stores (lifecycle/validators.ts's
 * separateBody on the server; InitiateSeparationAction.tsx used its own
 * separate copy of the same five values before this fix).
 */
export const SEPARATION_TYPES = ["resignation", "retirement", "termination", "vrs", "death"] as const;
export type SeparationType = (typeof SEPARATION_TYPES)[number];

type DatedRow = { superannuationDate: string; status?: string };

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Today's Asia/Kolkata calendar date as a date-only 'YYYY-MM-DD' string, for
 * chronological string comparison with the API's date-only effective dates.
 * (The UTC date is still "yesterday" until 05:30 IST, which would keep a
 * separation effective today out of "due now" for those hours.)
 */
export function todayDateOnly(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/** 'YYYY-MM-DD' plus whole calendar months, clamped to the last day of a shorter month. */
function addMonthsDateOnly(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Effective date is today or within the next `months` months (inclusive). */
export function isUpcoming(row: DatedRow, now: Date = new Date(), months = 6): boolean {
  if (!row.superannuationDate) return false;
  const today = todayDateOnly(now);
  const cutoff = addMonthsDateOnly(today, months);
  return dateOnly(row.superannuationDate) >= today && dateOnly(row.superannuationDate) <= cutoff;
}

/**
 * GAP-HR-RETIREMENT-05: an effective date that has already passed while the
 * separation is still "initiated" (i.e. nothing has advanced its status --
 * see GAP-HR-RETIREMENT-03) previously vanished from both the dashboard and
 * the wizard the moment "upcoming" stopped matching it, leaving it visible
 * only in the full register below. Overdue rows surface here instead.
 */
export function isOverdue(row: DatedRow, now: Date = new Date()): boolean {
  if (!row.superannuationDate) return false;
  if (row.status && row.status !== "initiated") return false;
  return dateOnly(row.superannuationDate) < todayDateOnly(now);
}

export function sortByDateAsc<T extends DatedRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => dateOnly(a.superannuationDate).localeCompare(dateOnly(b.superannuationDate)));
}

/**
 * The single partition every retirement surface uses (page KPIs, the card
 * dashboard and the processing wizard's selectable cases), so their counts
 * cannot disagree: rows whose effective date has passed while still
 * "initiated" (overdue, oldest first) and rows effective within the window
 * (upcoming, soonest first). `cases` is overdue followed by upcoming -- exactly
 * the cards the dashboard renders and the cases the wizard can open. Completed
 * or cancelled past rows are in neither.
 */
export function partitionRetirements<T extends DatedRow>(
  rows: readonly T[],
  now: Date = new Date(),
  months = 6,
): { overdue: T[]; upcoming: T[]; cases: T[] } {
  const overdue = sortByDateAsc(rows.filter((r) => isOverdue(r, now)));
  const upcoming = sortByDateAsc(rows.filter((r) => isUpcoming(r, now, months)));
  return { overdue, upcoming, cases: [...overdue, ...upcoming] };
}
