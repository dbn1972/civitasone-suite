/**
 * GAP-HR-APAR-03: how an APAR record's due date reads today.
 *
 * `deadline` is YYYY-MM-DD computed server-side (apar/deadlines.ts); `todayIst`
 * is the IST calendar date. Whole-day arithmetic on the two date strings (UTC
 * midnight both sides), so no timezone drift. Returns null when there is no
 * deadline or the record is finalised.
 */
export type DeadlineState =
  | { kind: "due"; days: number }
  | { kind: "today" }
  | { kind: "overdue"; days: number };

const DAY_MS = 86_400_000;

export function deadlineState(deadline: string | null | undefined, todayIst: string, finalised: boolean): DeadlineState | null {
  if (finalised || !deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return null;
  const diff = Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${todayIst}T00:00:00Z`)) / DAY_MS);
  if (Number.isNaN(diff)) return null;
  if (diff > 0) return { kind: "due", days: diff };
  if (diff === 0) return { kind: "today" };
  return { kind: "overdue", days: -diff };
}
