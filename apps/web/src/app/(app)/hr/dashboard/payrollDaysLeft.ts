import { istDateKey } from "@/lib/formatters";

/**
 * Days remaining in the current IST calendar month (0 on its last day).
 * CLOS2-S2-04: derived from the IST date, not the (UTC) host clock getters.
 */
export function payrollDaysLeft(now: Date = new Date()): number {
  const [y, m, d] = istDateKey(now).split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return daysInMonth - d;
}
