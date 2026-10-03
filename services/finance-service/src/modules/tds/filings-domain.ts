/**
 * GAP-FINANCE-STATUTORY-TDS-RETURNS-04 — pure domain for the quarterly TDS
 * return filing register (Form 26Q). The in-app record is made AFTER the
 * return has been filed on the external e-filing portal; nothing here talks to
 * TRACES. No DB, no HTTP.
 */

export type TdsQuarter = "Q1" | "Q2" | "Q3" | "Q4";
export const TDS_QUARTERS: readonly TdsQuarter[] = ["Q1", "Q2", "Q3", "Q4"];
export const DEFAULT_TDS_FORM = "26Q";

export class TdsFilingError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "TdsFilingError";
  }
}

/** First calendar year of an FY label "2026-27" -> 2026. */
export function fyStartYear(fy: string): number {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  if (!m) throw new TdsFilingError("INVALID_FY", "fy must look like 2026-27");
  const start = Number(m[1]);
  if ((start + 1) % 100 !== Number(m[2])) throw new TdsFilingError("INVALID_FY", "fy must be consecutive years, e.g. 2026-27");
  return start;
}

/** Last calendar day of a quarter of the FY (Q1 = Apr-Jun ... Q4 = Jan-Mar). */
export function quarterEndDate(fy: string, quarter: TdsQuarter): string {
  const y = fyStartYear(fy);
  switch (quarter) {
    case "Q1": return `${y}-06-30`;
    case "Q2": return `${y}-09-30`;
    case "Q3": return `${y}-12-31`;
    case "Q4": return `${y + 1}-03-31`;
  }
}

/**
 * Default due date of the quarterly statement. Configurable defaults, mirroring
 * the commonly published Income-tax due dates (31 Jul, 31 Oct, 31 Jan, 31 May).
 * A tenant/edition override can be supplied by the caller; VERIFY against the
 * current CBDT notification before relying on it as the statutory date.
 */
export const DEFAULT_TDS_DUE_DATES: Record<TdsQuarter, { month: string; day: string; nextYear: boolean }> = {
  Q1: { month: "07", day: "31", nextYear: false },
  Q2: { month: "10", day: "31", nextYear: false },
  Q3: { month: "01", day: "31", nextYear: true },
  Q4: { month: "05", day: "31", nextYear: true },
};

export function defaultDueDate(fy: string, quarter: TdsQuarter): string {
  const y = fyStartYear(fy);
  const d = DEFAULT_TDS_DUE_DATES[quarter];
  return `${d.nextYear ? y + 1 : y}-${d.month}-${d.day}`;
}

export type FilingDisplayStatus = "filed" | "pending" | "overdue";

/** pending until the due date passes (IST calendar date), then overdue; a recorded filing is "filed". */
export function filingStatus(filed: boolean, dueDate: string, todayIst: string): FilingDisplayStatus {
  if (filed) return "filed";
  return todayIst > dueDate ? "overdue" : "pending";
}

/** Acknowledgement / provisional receipt number: alphanumeric, 6-32 chars (format varies by form; VERIFY). */
const ACK_RE = /^[A-Za-z0-9]{6,32}$/;
export function assertValidAckNo(ackNo: string): void {
  if (!ACK_RE.test(ackNo)) {
    throw new TdsFilingError("INVALID_ACK_NO", "acknowledgement number must be 6-32 letters or digits");
  }
}

/** A return can only be recorded as filed once the quarter has ended, and never on a future date. */
export function assertValidFilingDate(fy: string, quarter: TdsQuarter, filedOn: string, todayIst: string): void {
  if (filedOn > todayIst) throw new TdsFilingError("FILED_ON_IN_FUTURE", "filed-on date cannot be in the future");
  if (filedOn <= quarterEndDate(fy, quarter)) {
    throw new TdsFilingError("FILED_BEFORE_QUARTER_END", "a return cannot be filed on or before the last day of its quarter");
  }
}

/** IST calendar date (YYYY-MM-DD) of an instant. */
export function istDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
