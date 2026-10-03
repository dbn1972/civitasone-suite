/**
 * GAP-PAYROLL-TAX-DECLARATION-05: pure evaluation of a tenant's per-FY
 * declaration submission window. No window row => always open (legacy).
 * Dates are compared as ISO calendar dates (YYYY-MM-DD) in IST, the zone
 * payroll deadlines are quoted in.
 */
export type WindowState = "open" | "not_open" | "closed";

export interface DeclarationWindow {
  open: boolean;
  state: WindowState;
  opensOn: string | null;
  closesOn: string | null;
}

/** Today's calendar date in Asia/Kolkata (UTC+05:30, no DST). */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** closesOn is the LAST day a declaration may be filed (inclusive). */
export function currentFyWindow(
  row: { opensOn: string | null; closesOn: string } | null,
  today: string,
): DeclarationWindow {
  if (!row) return { open: true, state: "open", opensOn: null, closesOn: null };
  if (row.opensOn && today < row.opensOn) return { open: false, state: "not_open", opensOn: row.opensOn, closesOn: row.closesOn };
  if (today > row.closesOn) return { open: false, state: "closed", opensOn: row.opensOn, closesOn: row.closesOn };
  return { open: true, state: "open", opensOn: row.opensOn, closesOn: row.closesOn };
}
