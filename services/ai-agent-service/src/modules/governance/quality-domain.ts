/**
 * governance/quality-domain.ts — AG-004 autonomous interaction quality scoring.
 * Pure functions only.
 *
 * Scores are carried as STRINGS with 4 decimal places because the column is
 * numeric(5,4). Parsing a stored score into a JS float and writing it back can
 * change the value (0.1 + 0.2 problem), and a quality score that drifts on every
 * round-trip is not evidence of anything.
 */

export const SAFETY_GATE = 0.5;
export const OVERALL_FLOOR = 0.6;

/** Weights sum to 1. Safety is weighted highest because a coherent, on-topic
 *  answer that is unsafe is worse than an incoherent one. */
export const WEIGHTS = { relevance: 0.35, coherence: 0.25, safety: 0.4 } as const;

export const SCORE_SCALE = 4;

export interface QualityDimensions {
  relevance: number;
  coherence: number;
  safety: number;
}

export interface QualityScore {
  relevance: string;
  coherence: string;
  safety: string;
  overall: string;
  flagged: boolean;
  flagReason: string | null;
}

function clamp01(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** numeric(5,4) → fixed-4 string. The single place a score becomes text. */
export function toScoreString(n: number): string {
  return clamp01(n).toFixed(SCORE_SCALE);
}

/**
 * Weighted overall score plus the review flag.
 *
 * HARD SAFETY GATE: if `safety` < 0.5 the interaction is flagged regardless of
 * relevance and coherence. A perfectly relevant, perfectly coherent answer that
 * is unsafe must still reach a human — averaging would let two strong dimensions
 * mask an unsafe one and the interaction would sail through unreviewed. The gate
 * is checked before the weighted average is even considered, and the weighted
 * average can never clear it.
 *
 * Secondary rule: an overall below 0.6 is flagged as low quality, so genuinely
 * poor-but-safe interactions still surface for review.
 */
export function computeOverall(dims: QualityDimensions): QualityScore {
  const relevance = clamp01(dims.relevance);
  const coherence = clamp01(dims.coherence);
  const safety = clamp01(dims.safety);

  const weighted =
    relevance * WEIGHTS.relevance + coherence * WEIGHTS.coherence + safety * WEIGHTS.safety;
  // Round to the column's scale before comparing against the floor so the stored
  // value and the flag decision can never disagree.
  const overall = Number(weighted.toFixed(SCORE_SCALE));

  let flagged = false;
  let flagReason: string | null = null;

  if (safety < SAFETY_GATE) {
    flagged = true;
    flagReason = `safety ${safety.toFixed(SCORE_SCALE)} below hard gate ${SAFETY_GATE.toFixed(SCORE_SCALE)}`;
  } else if (overall < OVERALL_FLOOR) {
    flagged = true;
    flagReason = `overall ${overall.toFixed(SCORE_SCALE)} below floor ${OVERALL_FLOOR.toFixed(SCORE_SCALE)}`;
  }

  return {
    relevance: toScoreString(relevance),
    coherence: toScoreString(coherence),
    safety: toScoreString(safety),
    overall: toScoreString(overall),
    flagged,
    flagReason,
  };
}

export interface QualitySummary {
  scored: number;
  flagged: number;
  flaggedPct: number;
}

/** Flag-rate stats over a set of scores. Empty input ⇒ all zeros (no divide by zero). */
export function summarizeQuality(rows: Array<{ flagged?: boolean | null }>): QualitySummary {
  const scored = rows.length;
  const flagged = rows.reduce((n, r) => (r.flagged === true ? n + 1 : n), 0);
  return {
    scored,
    flagged,
    flaggedPct: scored === 0 ? 0 : Math.round((flagged / scored) * 10000) / 100,
  };
}
