/** Central govt restricted holidays used for working-day leave calculations (extend via config later). */
export const RESTRICTED_HOLIDAYS = new Set([
  "2024-01-26", "2024-08-15", "2024-10-02", "2024-12-25",
  "2025-01-26", "2025-08-15", "2025-10-02", "2025-12-25",
  "2026-01-26", "2026-08-15", "2026-10-02", "2026-12-25",
]);

export function isWorkingDay(dateStr: string): boolean {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  if (RESTRICTED_HOLIDAYS.has(dateStr)) return false;
  return true;
}

export function countWorkingDays(fromDate: string, toDate: string): number {
  const from = new Date(`${fromDate}T00:00:00Z`);
  const to = new Date(`${toDate}T00:00:00Z`);
  let count = 0;
  const cur = new Date(from);
  while (cur <= to) {
    const iso = cur.toISOString().slice(0, 10);
    if (isWorkingDay(iso)) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return Math.max(count, 1);
}
