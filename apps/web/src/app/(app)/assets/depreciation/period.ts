import { todayIST } from "@/lib/formatters";

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * GAP-ASSETS-DEPRECIATION-02: a period is valid when it is YYYY-MM and not
 * later than the current IST month (depreciation cannot be posted for a
 * month that has not started). Returns an error message or null.
 */
export function periodError(period: string, currentMonth = todayIST().slice(0, 7)): string | null {
  if (!PERIOD_RE.test(period)) return "Choose a period (month and year).";
  if (period > currentMonth) return `Period ${period} is in the future; choose ${currentMonth} or earlier.`;
  return null;
}
