/**
 * Accounting-period status for a posting date (GAP-FINANCE-JOURNAL-ENTRY-03).
 * Advisory only: the UI uses it to warn or block early, but finance-service
 * stays authoritative and enforces closed periods on the journal consumer.
 */
export type PeriodStatusRow = { period: string; status: string };

export type PostingDateCheck =
  | { kind: "open"; period: string }
  | { kind: "soft_close"; period: string }
  | { kind: "hard_close"; period: string }
  /** The period list loaded but has no row for that month (or an unknown status). */
  | { kind: "unknown"; period: string }
  /** The period list failed to load, so closed-period status cannot be verified. */
  | { kind: "unverified"; period: string };

/** The YYYY-MM period a YYYY-MM-DD posting date falls in, or null for a malformed date. */
export function periodOfDate(date: string): string | null {
  return /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(date) ? date.slice(0, 7) : null;
}

/** `periods === null` means the period list failed to load. */
export function checkPostingDate(date: string, periods: readonly PeriodStatusRow[] | null): PostingDateCheck | null {
  const period = periodOfDate(date);
  if (!period) return null;
  if (periods === null) return { kind: "unverified", period };
  const row = periods.find((p) => p.period === period);
  if (!row) return { kind: "unknown", period };
  const status = row.status.toLowerCase();
  if (status === "open") return { kind: "open", period };
  if (status === "soft_close") return { kind: "soft_close", period };
  if (status === "hard_close") return { kind: "hard_close", period };
  return { kind: "unknown", period };
}
