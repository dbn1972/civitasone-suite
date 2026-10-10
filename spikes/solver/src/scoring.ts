/**
 * scoring.ts — the objective function F(x) (spec §7.1) and the canonical plan
 * hash. Both the solver and the validator use these so "score" means one thing.
 *
 * Scores are INTEGERS (scaled) so comparisons and the min-cost-flow reduction are
 * exact and identical on arm64 and x64 — no floating-point objective anywhere.
 */

import { createHash } from "node:crypto";
import type {
  AllocationPlan,
  Assignment,
  EmployeePreference,
  SnapshotEmployee,
  SnapshotPosition,
  SoftObjective,
  UnassignedEmployee,
} from "./SolverPort.js";

export interface ScoringContext {
  readonly weights: Map<string, number>;
  readonly prefRank: Map<string, Map<string, number>>; // employeeId -> positionId -> rank
  readonly maxPrefLen: number;
}

export function buildScoringContext(
  softObjectives: readonly SoftObjective[],
  preferences: readonly EmployeePreference[],
): ScoringContext {
  const weights = new Map<string, number>();
  for (const s of softObjectives) weights.set(s.kind, s.weight);
  const prefRank = new Map<string, Map<string, number>>();
  let maxPrefLen = 1;
  for (const p of preferences) {
    const m = new Map<string, number>();
    p.rankedPositionIds.forEach((pid, idx) => m.set(pid, idx));
    prefRank.set(p.employeeId, m);
    if (p.rankedPositionIds.length > maxPrefLen) maxPrefLen = p.rankedPositionIds.length;
  }
  return { weights, prefRank, maxPrefLen };
}

/**
 * Marginal integer score of posting employee `e` into position `p`. Higher is
 * better. Only soft objectives contribute — hard feasibility is a precondition
 * checked elsewhere (P06: hard constraints are never traded for score).
 */
export function pairScore(
  e: SnapshotEmployee,
  p: SnapshotPosition,
  ctx: ScoringContext,
): number {
  let s = 0;
  const w = (k: string) => ctx.weights.get(k) ?? 0;

  // preference: most-preferred post scores highest; unranked scores 0.
  const rank = ctx.prefRank.get(e.id)?.get(p.id);
  if (rank !== undefined) {
    s += w("preference") * (ctx.maxPrefLen - rank);
  }

  // hardshipPriority: approved hardship raises the value of ANY assignment.
  s += w("hardshipPriority") * e.hardshipPriority;

  // tenureFairness: longer-tenured employees gain more from a move (capped).
  s += w("tenureFairness") * Math.min(e.tenureMonths, 60);

  // minimumDisruption: staying in the same location class is less disruptive.
  // (No current post in the synthetic snapshot → neutral; kept for completeness.)
  s += w("minimumDisruption") * 0;

  // criticalVacancyCoverage: filling a sensitive post is worth more.
  if (p.sensitive) s += w("criticalVacancyCoverage");

  return s;
}

/** Total objective F(x) over committed assignments. */
export function totalScore(assignments: readonly Assignment[]): number {
  let t = 0;
  for (const a of assignments) t += a.score;
  return t;
}

/**
 * Canonical plan hash: sha256 over the sorted, stringified output. Assignments
 * sorted by (employeeId, positionId); unassigned sorted by employeeId with its
 * blocking constraints sorted. Excludes wall-clock/perf fields entirely.
 */
export function planHash(
  snapshotId: string,
  seed: number,
  assignments: readonly Assignment[],
  unassigned: readonly UnassignedEmployee[],
  score: number,
): string {
  const canonAssign = [...assignments]
    .map((a) => ({ e: a.employeeId, p: a.positionId, s: a.score }))
    .sort((a, b) => (a.e < b.e ? -1 : a.e > b.e ? 1 : a.p < b.p ? -1 : a.p > b.p ? 1 : 0));
  const canonUnassigned = [...unassigned]
    .map((u) => ({ e: u.employeeId, b: [...u.minimalBlockingConstraints].sort() }))
    .sort((a, b) => (a.e < b.e ? -1 : a.e > b.e ? 1 : 0));
  const canonical = JSON.stringify({
    snapshotId,
    seed,
    score,
    assignments: canonAssign,
    unassigned: canonUnassigned,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Recompute a plan's hash from its own fields — used by the validator. */
export function rehash(plan: AllocationPlan): string {
  return planHash(plan.snapshotId, plan.seed, plan.assignments, plan.unassigned, plan.score);
}
