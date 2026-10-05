/**
 * Financial-year period helpers for the CRM forecast (GAP-CRM-FORECAST-03).
 *
 * The Indian financial year runs 1 April – 31 March. A forecast total is
 * meaningless without a horizon, so the UI lets a user scope the weighted total
 * to a FY quarter (or a whole FY) and resolves that choice to an inclusive
 * close-date window the server filters on. All dates are plain ISO calendar
 * dates (YYYY-MM-DD) — no time zone maths, matching the deals.expected_close_date
 * date column.
 */

export interface ForecastPeriod {
  /** Opaque key carried in the URL, e.g. "fy2026-q2" or "fy2026". */
  key: string;
  /** Human label shown in the picker and the applied-period subtitle. */
  label: string;
  /** Inclusive close-date window (YYYY-MM-DD). */
  closeDateFrom: string;
  closeDateTo: string;
  /** FY starting calendar year; with `quarter` lets the UI build a translated label. */
  startYear: number;
  /** 1-4 for a quarter; undefined for a whole FY. */
  quarter?: 1 | 2 | 3 | 4;
}

/**
 * Translated period label. `t` is a next-intl translator scoped to the
 * "crmForecastPeriod" namespace; the English output is identical to `label`.
 */
export function localizedPeriodLabel(
  p: ForecastPeriod,
  t: (key: string, values?: Record<string, string>) => string,
): string {
  const values = { start: String(p.startYear), end: (p.startYear + 1).toString().slice(-2) };
  return p.quarter ? t("quarterLabel", { ...values, q: String(p.quarter) }) : t("fullYearLabel", values);
}

/** The FY an ISO date belongs to (the starting calendar year, e.g. FY starting Apr 2026 → 2026). */
export function financialYearStartYear(d: Date): number {
  // Months are 0-based; Jan/Feb/Mar (0,1,2) belong to the FY that started the previous April.
  return d.getUTCMonth() <= 2 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
}

function iso(year: number, month1: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month1.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

/** The four quarters of the FY starting in April `startYear`. */
export function fyQuarters(startYear: number): ForecastPeriod[] {
  const label = `FY ${startYear}-${(startYear + 1).toString().slice(-2)}`;
  return [
    { key: `fy${startYear}-q1`, label: `${label} · Q1 (Apr–Jun)`, closeDateFrom: iso(startYear, 4, 1), closeDateTo: iso(startYear, 6, 30), startYear, quarter: 1 },
    { key: `fy${startYear}-q2`, label: `${label} · Q2 (Jul–Sep)`, closeDateFrom: iso(startYear, 7, 1), closeDateTo: iso(startYear, 9, 30), startYear, quarter: 2 },
    { key: `fy${startYear}-q3`, label: `${label} · Q3 (Oct–Dec)`, closeDateFrom: iso(startYear, 10, 1), closeDateTo: iso(startYear, 12, 31), startYear, quarter: 3 },
    { key: `fy${startYear}-q4`, label: `${label} · Q4 (Jan–Mar)`, closeDateFrom: iso(startYear + 1, 1, 1), closeDateTo: iso(startYear + 1, 3, 31), startYear, quarter: 4 },
  ];
}

/** A whole-FY period. */
export function fyWhole(startYear: number): ForecastPeriod {
  const label = `FY ${startYear}-${(startYear + 1).toString().slice(-2)}`;
  return { key: `fy${startYear}`, label: `${label} (full year)`, closeDateFrom: iso(startYear, 4, 1), closeDateTo: iso(startYear + 1, 3, 31), startYear };
}

/**
 * The period options offered in the picker: the current FY (whole + four
 * quarters) and the next FY (whole + four quarters), newest first-ish, with the
 * current FY's quarters surfaced first.
 */
export function periodOptions(now: Date = new Date()): ForecastPeriod[] {
  const start = financialYearStartYear(now);
  return [
    fyWhole(start),
    ...fyQuarters(start),
    fyWhole(start + 1),
    ...fyQuarters(start + 1),
  ];
}

/** Resolve a URL period key to its window, or null when unknown/absent. */
export function resolvePeriod(key: string | undefined, now: Date = new Date()): ForecastPeriod | null {
  if (!key) return null;
  return periodOptions(now).find((p) => p.key === key) ?? null;
}
