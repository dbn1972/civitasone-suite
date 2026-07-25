/**
 * SVC-099 Enterprise risk & control register — pure domain.
 * Residual scoring reuses the 5x5 matrix from the risk module; this file adds
 * the acceptance maker-checker guard and the periodic review-cycle date math.
 */
import { computeRiskScore, type Likelihood, type Impact } from "../risk/domain.js";

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export { computeRiskScore };

/**
 * Residual score after controls: the inherent likelihood/impact score reduced
 * by a control-effectiveness factor (clamped to >= 1). Pure & deterministic.
 */
export type Effectiveness = "not_tested" | "ineffective" | "partial" | "effective";

const EFFECTIVENESS_REDUCTION: Record<Effectiveness, number> = {
  not_tested: 0,
  ineffective: 0,
  partial: 0.4,
  effective: 0.7,
};

export function computeResidualScore(likelihood: Likelihood, impact: Impact, effectiveness: Effectiveness): number {
  const inherent = computeRiskScore(likelihood, impact);
  const reduction = EFFECTIVENESS_REDUCTION[effectiveness];
  if (reduction === undefined) {
    throw new DomainError("INVALID_EFFECTIVENESS", `unknown effectiveness: ${effectiveness}`);
  }
  return Math.max(1, Math.round(inherent * (1 - reduction)));
}

/**
 * Ordinal rank of an effectiveness by how much it reduces residual risk.
 * `not_tested` and `ineffective` both credit zero reduction.
 */
const EFFECTIVENESS_RANK: Record<Effectiveness, number> = {
  not_tested: 0,
  ineffective: 0,
  partial: 1,
  effective: 2,
};

/**
 * The strongest (most risk-reducing) effectiveness among the controls on a risk.
 * Defaults to `not_tested` (no reduction, so residual == inherent) when the risk
 * has no controls, so an unmitigated high risk can never be understated.
 */
export function strongestEffectiveness(list: Effectiveness[]): Effectiveness {
  return list.reduce<Effectiveness>(
    (best, e) => (EFFECTIVENESS_RANK[e] > EFFECTIVENESS_RANK[best] ? e : best),
    "not_tested",
  );
}

/** Maker-checker guard for a risk acceptance decision. */
export function assertDifferentActor(makerId: string, checkerId: string, subject = "risk acceptance"): void {
  if (!checkerId) {
    throw new DomainError("CHECKER_REQUIRED", `${subject} requires an approving authority`);
  }
  if (makerId === checkerId) {
    throw new DomainError("MAKER_CHECKER_VIOLATION", `${subject} must be approved by a different authority than the one who requested it`);
  }
}

export type ReviewCadence = "monthly" | "quarterly" | "half_yearly" | "annual";

const CADENCE_DAYS: Record<ReviewCadence, number> = {
  monthly: 30,
  quarterly: 91,
  half_yearly: 182,
  annual: 365,
};

/** Next review date for the periodic review cycle. */
export function computeNextReviewDate(from: Date, cadence: ReviewCadence): Date {
  const days = CADENCE_DAYS[cadence];
  if (!days) throw new DomainError("INVALID_CADENCE", `unknown cadence: ${cadence}`);
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/** A review is due when now >= nextReviewDate. */
export function isReviewDue(nextReviewDate: Date, now: Date = new Date()): boolean {
  return now.getTime() >= nextReviewDate.getTime();
}
