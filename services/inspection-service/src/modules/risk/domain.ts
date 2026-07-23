/**
 * Risk scoring domain — pure functions for computing and validating risk scores.
 *
 * No side effects, no DB access, no I/O. Fully deterministic and property-testable.
 *
 * _Requirements: 3.1, 3.2, 3.8_
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A single risk factor within a risk model.
 *
 * `weight` is a value in [0, 1] such that all factor weights in a model sum to 1.0 (±0.001).
 * `scoringFunction` identifies the computation strategy (e.g. "linear", "threshold").
 * `dataSource` identifies where the raw input data comes from (e.g. "violation_history").
 */
export interface RiskFactor {
  /** Human-readable factor identifier (unique within a model). */
  name: string;
  /** Weight in [0, 1]; all weights in the model must sum to 1.0 ±0.001. */
  weight: number;
  /** Identifier for the scoring algorithm applied to raw data. */
  scoringFunction: string;
  /** Source of raw data for this factor (e.g. "violation_history", "time_since_last"). */
  dataSource: string;
}

/**
 * The scored result for a single factor within a risk computation.
 */
export interface FactorScore {
  /** Name of the risk factor (matches `RiskFactor.name`). */
  factorName: string;
  /** The raw score (0–100) before weighting. */
  rawScore: number;
  /** The weighted contribution: `rawScore * weight`. */
  weightedScore: number;
}

/**
 * The complete result of a risk score computation.
 */
export interface RiskScoreResult {
  /** Final composite score, clamped to [0, 100] and rounded to the nearest integer. */
  score: number;
  /** Per-factor breakdown showing raw and weighted contributions. */
  breakdown: FactorScore[];
}

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * Domain-level error for risk scoring violations (invalid model configuration, etc.).
 * Kept separate from HttpError to maintain pure domain boundary.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

// ── Pure Functions ────────────────────────────────────────────────────────────

/**
 * Validate that the weights of all factors in a risk model sum to 1.0 within tolerance.
 *
 * @param factors - Array of risk factors to validate.
 * @returns `true` if the sum of weights is within [0.999, 1.001].
 * @throws {DomainError} with code `INVALID_WEIGHT_SUM` if the sum falls outside tolerance.
 *
 * _Validates: Requirements 3.1, 3.8_
 */
export function validateWeightSum(factors: RiskFactor[]): true {
  const sum = factors.reduce((acc, f) => acc + f.weight, 0);
  if (sum < 0.999 || sum > 1.001) {
    throw new DomainError(
      "INVALID_WEIGHT_SUM",
      `Risk factor weights must sum to 1.0 (±0.001), got ${sum.toFixed(6)}`,
    );
  }
  return true;
}

/**
 * Compute the composite risk score for a set of factors and their raw scores.
 *
 * The score is calculated as:
 *   score = round(Σ factor.weight × rawScore[factor.name])
 * then clamped to the range [0, 100].
 *
 * If a raw score for a factor is missing from the map, it is treated as 0.
 *
 * @param factors - The risk model's factors (with weights).
 * @param rawScores - A map of factor name → raw score (0–100 expected, but not enforced).
 * @returns The composite score (integer 0–100) and a per-factor breakdown.
 *
 * _Validates: Requirements 3.2, 3.8_
 */
export function computeRiskScore(
  factors: RiskFactor[],
  rawScores: Map<string, number>,
): RiskScoreResult {
  const breakdown: FactorScore[] = factors.map((factor) => {
    const rawScore = rawScores.get(factor.name) ?? 0;
    const weightedScore = factor.weight * rawScore;
    return {
      factorName: factor.name,
      rawScore,
      weightedScore,
    };
  });

  const rawSum = breakdown.reduce((acc, fs) => acc + fs.weightedScore, 0);
  const score = Math.max(0, Math.min(100, Math.round(rawSum)));

  return { score, breakdown };
}
