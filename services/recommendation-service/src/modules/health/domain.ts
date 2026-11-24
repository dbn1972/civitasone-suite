/**
 * health/domain.ts — Pure account health scoring.
 *
 * Health is an RFM-style composite: recency, frequency and monetary value of
 * the relationship, adjusted by support load and engagement. Each factor is
 * supplied already normalised to 0..100 by the caller so this module stays
 * free of data access and of tenant-specific thresholds.
 */

import {
  SIGNAL_WEIGHTS,
  HEALTH_SIGNAL_NAMES,
  computeHealthScore as computeSignalScore,
  type HealthSignals,
  type HealthSignalName,
} from "./scoring-domain.js";

/**
 * Factors are the KA-004 signals (productUsage, engagement, supportBurden,
 * paymentTimeliness, relationshipDepth). The recompute WRITE path and the
 * breakdown READ path (scoring-routes.ts) must share one key set, otherwise the
 * stored factors read back as all-zero. Single source of truth: scoring-domain.ts.
 */
export type HealthFactors = HealthSignals;

/** Relative weights — sum to 1 so the composite stays inside 0..100. */
export const HEALTH_WEIGHTS = SIGNAL_WEIGHTS;

export type HealthFactorName = HealthSignalName;

export const HEALTH_FACTOR_NAMES: readonly HealthFactorName[] = HEALTH_SIGNAL_NAMES;

export type HealthClassification = "critical" | "at_risk" | "healthy" | "excellent";

/** Lower bound (inclusive) of each band. */
export const HEALTH_BANDS = {
  atRisk: 40,
  healthy: 60,
  excellent: 80,
} as const;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Weighted 0..100 health score (same weights/clamping as the breakdown read
 * path). Missing factors contribute zero, which is deliberate: an account with
 * no signal is not a healthy account.
 */
export function computeHealthScore(factors: HealthFactors): number {
  return computeSignalScore(factors).score;
}

/** Map a 0..100 score onto a relationship-health band. */
export function classifyHealth(score: number): HealthClassification {
  const value = clamp(score, 0, 100);
  if (value >= HEALTH_BANDS.excellent) return "excellent";
  if (value >= HEALTH_BANDS.healthy) return "healthy";
  if (value >= HEALTH_BANDS.atRisk) return "at_risk";
  return "critical";
}

/**
 * Validate a factor bundle. Returns null when valid, otherwise a human message
 * suitable for a 422 response.
 */
export function validateFactors(factors: HealthFactors): string | null {
  if (factors === null || typeof factors !== "object") return "factors must be an object";

  const entries = Object.entries(factors as Record<string, unknown>);
  const known = new Set<string>(HEALTH_FACTOR_NAMES);

  for (const [key, value] of entries) {
    if (!known.has(key)) return `unknown factor: ${key}`;
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return `${key} must be a finite number`;
    }
    if (value < 0 || value > 100) {
      return `${key} must be between 0 and 100`;
    }
  }

  const provided = entries.filter(([, value]) => value !== undefined);
  if (provided.length === 0) return "at least one factor is required";

  return null;
}
