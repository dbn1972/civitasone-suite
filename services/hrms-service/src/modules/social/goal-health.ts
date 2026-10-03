/**
 * GAP-HR-GOALS-04: goal health (on track / at risk / behind) derived from
 * progress vs the time elapsed to the due date -- previously nothing in the
 * product could ever produce at_risk/behind, so "At Risk / Behind" was
 * permanently 0.
 *
 * Rules (defaults; thresholds are named constants, listed as a VERIFY item):
 *  - completed / achieved stay as they are.
 *  - a status somebody set deliberately via PATCH /goals/:id (on_track,
 *    at_risk, behind) is respected -- never recomputed over their head, and a
 *    check-in no longer overwrites it (see statusAfterCheckin).
 *  - only an automatic 'active' goal is derived:
 *      no due date                  -> on_track (nothing to measure against)
 *      past due and progress < 100  -> behind
 *      else expected = % of the start..due window already elapsed;
 *           shortfall = expected - progress;
 *           shortfall > BEHIND_SHORTFALL_PCT  -> behind
 *           shortfall > AT_RISK_SHORTFALL_PCT -> at_risk
 *           otherwise                         -> on_track
 * Start of the window = the goal's creation date.
 */
export const AT_RISK_SHORTFALL_PCT = 15;
export const BEHIND_SHORTFALL_PCT = 30;

export type GoalHealth = "on_track" | "at_risk" | "behind" | "completed";

const MANUAL_STATUSES = ["on_track", "at_risk", "behind"] as const;

function utcDay(d: string | Date): number | null {
  const iso = typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

export function goalHealth(
  g: { status: string; progress: number | string | null; createdAt: string | Date; dueDate: string | Date | null },
  todayIso: string,
): GoalHealth {
  const status = (g.status ?? "").toLowerCase();
  if (status === "completed" || status === "achieved") return "completed";
  if ((MANUAL_STATUSES as readonly string[]).includes(status)) return status as GoalHealth;
  const progress = Math.max(0, Math.min(100, Number(g.progress ?? 0) || 0));
  if (progress >= 100) return "completed";
  const due = g.dueDate ? utcDay(g.dueDate) : null;
  const start = utcDay(g.createdAt);
  const today = utcDay(todayIso);
  if (due === null || start === null || today === null) return "on_track";
  if (today > due) return "behind";
  const window = due - start;
  const expected = window <= 0 ? 100 : Math.max(0, Math.min(100, ((today - start) / window) * 100));
  const shortfall = expected - progress;
  if (shortfall > BEHIND_SHORTFALL_PCT) return "behind";
  if (shortfall > AT_RISK_SHORTFALL_PCT) return "at_risk";
  return "on_track";
}

/** What a progress check-in writes to `status`: completion wins; a manually set health survives; otherwise 'active'. */
export function statusAfterCheckin(currentStatus: string, newProgress: number): string {
  if (newProgress >= 100) return "completed";
  const cur = (currentStatus ?? "").toLowerCase();
  return (MANUAL_STATUSES as readonly string[]).includes(cur) ? cur : "active";
}
