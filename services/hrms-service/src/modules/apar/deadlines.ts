/**
 * GAP-HR-APAR-03: per-stage APAR due date.
 *
 * - Officer stages (self appraisal -> reporting -> reviewing -> accepting):
 *   the tenant's `apar_deadlines` policy (MM-DD per stage, defaults in
 *   policy-settings/registry.ts) in the calendar year AFTER the financial year
 *   starts: period 2025-26 -> 30 Apr 2026, 31 May 2026, ...
 * - disclosed / representation: the record's own representationDue (set when
 *   the grade is disclosed).
 * - finalised or any unknown status: no deadline.
 *
 * Pure -- takes the already-resolved policy, so it is trivial to test.
 */
import type { AparDeadlines } from "../policy-settings/registry.js";

const STAGE_KEYS = ["self_pending", "reporting_officer", "reviewing_officer", "accepting_authority"] as const;
type StageKey = (typeof STAGE_KEYS)[number];

function isStageKey(s: string): s is StageKey {
  return (STAGE_KEYS as readonly string[]).includes(s);
}

/** `mmdd` in the given year, or null when that calendar date does not exist (e.g. 02-30). */
function dateOrNull(year: number, mmdd: string): string | null {
  const iso = `${year}-${mmdd}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

export function aparDeadline(
  row: { status: string; appraisalPeriod: string; representationDue?: string | Date | null },
  policy: AparDeadlines,
): string | null {
  if (row.status === "disclosed" || row.status === "representation") {
    const due = row.representationDue;
    if (!due) return null;
    return typeof due === "string" ? due.slice(0, 10) : due.toISOString().slice(0, 10);
  }
  if (!isStageKey(row.status)) return null;
  const m = /^(\d{4})-\d{2}$/.exec(row.appraisalPeriod);
  if (!m) return null;
  return dateOrNull(Number(m[1]) + 1, policy[row.status]);
}
