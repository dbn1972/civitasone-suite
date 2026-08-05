/**
 * Pure stage-ageing / stalled-opportunity maths (OP-005).
 *
 * `stage_entered_at` on a deal marks when it landed in its current stage; a per-tenant
 * (optionally per-pipeline) `stage_limits.max_days` says how long that is allowed to
 * last. A deal is STALLED once its days-in-stage exceeds the limit. All comparisons are
 * done in whole days from injected `now` so the function is deterministic and testable.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days (floored) the deal has sat in its current stage. */
export function daysInStage(stageEnteredAt: Date | string | null, now: Date): number {
  if (stageEnteredAt === null) return 0;
  const entered = typeof stageEnteredAt === "string" ? new Date(stageEnteredAt) : stageEnteredAt;
  const ms = now.getTime() - entered.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / MS_PER_DAY);
}

export interface AgeingInput {
  stageEnteredAt: Date | string | null;
  maxDays: number | null;
  now: Date;
}

export interface AgeingResult {
  daysInStage: number;
  maxDays: number | null;
  stalled: boolean;
  daysOverLimit: number;
}

/**
 * Evaluate a single opportunity's ageing against its configured limit. With no limit
 * (maxDays null) a deal is never stalled — the dashboard only flags deals a tenant has
 * actually set a limit for.
 */
export function evaluateAgeing(input: AgeingInput): AgeingResult {
  const days = daysInStage(input.stageEnteredAt, input.now);
  const stalled = input.maxDays !== null && days > input.maxDays;
  return {
    daysInStage: days,
    maxDays: input.maxDays,
    stalled,
    daysOverLimit: stalled ? days - (input.maxDays as number) : 0,
  };
}
