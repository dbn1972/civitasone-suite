/**
 * SVC-040 — Outcome / Output budgeting pure domain.
 *
 * Links a budget allocation to the outputs it funds, the outcomes those outputs
 * are meant to achieve, and the indicators/targets used to measure achievement.
 * No DB, no HTTP, no queue — unit-tested in isolation.
 */
import { DomainError } from "./domain.js";

export type OutcomeStatus = "draft" | "active" | "evaluated" | "closed";
export type OutcomeRating = "not_achieved" | "at_risk" | "on_track" | "achieved";

export interface OutcomeLinkage {
  indicator: string;
  unit: string;
  targetValue: bigint;    // measurable target (e.g. 1200 = 1200 km of road)
  baselineValue: bigint;  // starting point
  allocatedMinor: bigint; // paise of the parent allocation earmarked to this output
}

const BPS = 10_000n; // 100.00% expressed in basis points

/**
 * Achievement ratio in basis points (integer, no float) relative to the target,
 * net of the baseline. `(achieved - baseline) / (target - baseline) * 10000`.
 * Clamped at 0 (negative progress reads as 0). Returns 10000 (=100%) when the
 * target equals the baseline (nothing left to achieve).
 */
export function achievementRatioBps(l: Pick<OutcomeLinkage, "targetValue" | "baselineValue">, achieved: bigint): bigint {
  const span = l.targetValue - l.baselineValue;
  if (span <= 0n) return BPS;
  const progress = achieved - l.baselineValue;
  if (progress <= 0n) return 0n;
  const bps = (progress * BPS) / span;
  return bps > BPS ? BPS : bps;
}

/**
 * Classify achievement into an evaluation rating using the basis-point ratio:
 *   >= 100%  → achieved
 *   >=  75%  → on_track
 *   >=  50%  → at_risk
 *   <   50%  → not_achieved
 */
export function classifyAchievement(l: Pick<OutcomeLinkage, "targetValue" | "baselineValue">, achieved: bigint): OutcomeRating {
  const bps = achievementRatioBps(l, achieved);
  if (bps >= BPS) return "achieved";
  if (bps >= 7_500n) return "on_track";
  if (bps >= 5_000n) return "at_risk";
  return "not_achieved";
}

/**
 * An outcome row must carry a measurable linkage: a non-empty indicator + unit,
 * a positive target, a non-negative baseline below the target, and a
 * non-negative earmarked allocation. Rejects incoherent frameworks up front so
 * evaluation later is meaningful.
 */
export function assertOutcomeLinkageValid(l: OutcomeLinkage): void {
  if (!l.indicator || l.indicator.trim().length === 0) {
    throw new DomainError("INVALID_OUTCOME", "indicator must not be empty");
  }
  if (!l.unit || l.unit.trim().length === 0) {
    throw new DomainError("INVALID_OUTCOME", "unit of measure must not be empty");
  }
  if (l.targetValue <= 0n) {
    throw new DomainError("INVALID_OUTCOME", "target value must be positive");
  }
  if (l.baselineValue < 0n) {
    throw new DomainError("INVALID_OUTCOME", "baseline value must not be negative");
  }
  if (l.baselineValue >= l.targetValue) {
    throw new DomainError("INVALID_OUTCOME", "baseline must be below the target");
  }
  if (l.allocatedMinor < 0n) {
    throw new DomainError("INVALID_OUTCOME", "allocated amount must not be negative");
  }
}

/** Achievement readings cannot be negative. */
export function assertAchievementValid(achieved: bigint): void {
  if (achieved < 0n) {
    throw new DomainError("INVALID_ACHIEVEMENT", "achieved value must not be negative");
  }
}

/**
 * Maker-checker on evaluation: the officer evaluating an outcome must differ
 * from the officer who created it, so an output cannot be self-certified as
 * achieved by the same hand that framed the target.
 */
export function assertEvaluatorDistinct(createdBy: string, evaluatorId: string): void {
  if (createdBy === evaluatorId) {
    throw new DomainError(
      "MAKER_CHECKER_VIOLATION",
      "outcome evaluator must differ from the officer who created it (maker-checker)",
    );
  }
}
