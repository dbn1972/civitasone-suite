/**
 * GAP-FINANCE-BUDGET-OUTCOME-BUDGET-03: classify each outcome indicator by its
 * server-computed achievementBps (basis points; 10000 = 100%) with an explicit
 * bucket per case -- counts are never derived by subtraction, so a missing
 * measurement can no longer pass as "not started".
 */
export type OutcomeBuckets = { achieved: number; inProgress: number; notStarted: number; notMeasured: number };

/** achievementBps as a finite number, or null when absent/blank/unparseable. */
export function achievementBpsOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function classifyOutcomes(outcomes: ReadonlyArray<{ achievementBps?: unknown }>): OutcomeBuckets {
  const out: OutcomeBuckets = { achieved: 0, inProgress: 0, notStarted: 0, notMeasured: 0 };
  for (const o of outcomes) {
    const bps = achievementBpsOrNull(o.achievementBps);
    if (bps === null) out.notMeasured += 1;
    else if (bps >= 10000) out.achieved += 1;
    else if (bps > 0) out.inProgress += 1;
    else out.notStarted += 1;
  }
  return out;
}
