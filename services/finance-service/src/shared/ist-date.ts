/**
 * UAT T-PERIOD D-06: every "today" the finance service computes is the Indian calendar date (Asia/Kolkata, UTC+05:30,
 * no daylight saving), never the UTC date. The servers run in UTC, so `new Date().toISOString().slice(0, 10)` put every
 * system-dated posting made between 00:00 and 05:30 IST on the PREVIOUS day -- and, on 1 April, in the previous
 * financial year (into a closed period, so it was refused). Use these helpers wherever a posting, voucher, report or
 * default date is derived from the clock.
 */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** The IST calendar date (YYYY-MM-DD) of an instant (default: now). */
export function todayIST(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The IST accounting period (YYYY-MM) of an instant (default: now). */
export function currentPeriodIST(now: Date = new Date()): string {
  return todayIST(now).slice(0, 7);
}

/** The Indian financial year (April-March, "YYYY-YY") that contains an IST calendar date (YYYY-MM-DD or YYYY-MM). */
export function fyOfDate(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** The financial year of an instant, by its IST date (default: now). */
export function currentFyIST(now: Date = new Date()): string {
  return fyOfDate(todayIST(now));
}

/** First and last calendar date of a financial year "YYYY-YY". */
export function fyBounds(fy: string): { start: string; end: string } {
  const startYear = Number(fy.slice(0, 4));
  return { start: `${startYear}-04-01`, end: `${startYear + 1}-03-31` };
}

/** The financial year that follows "YYYY-YY". */
export function nextFy(fy: string): string {
  const y = Number(fy.slice(0, 4)) + 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

/** The financial year that precedes "YYYY-YY". */
export function previousFy(fy: string): string {
  const y = Number(fy.slice(0, 4)) - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}
