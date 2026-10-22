/**
 * APAR / SPARROW grade engine.
 * Server-computes the overall numeric grade as the weighted mean of the
 * Reporting-Officer per-attribute scores (each 1..10), then maps it to a
 * standard DoPT band.
 */

export interface ScoreInput {
  attribute: string;
  weight: number; // relative weight (defaults to 1)
  score: number;  // 1..10
}

export type AparBand = "Outstanding" | "Very Good" | "Good" | "Average" | "Below Average";

export interface GradeResult {
  overallGrade: number;     // weighted mean, 2 dp, on the 1..10 scale
  band: AparBand;
  totalWeight: number;
  attributeCount: number;
}

/**
 * DoPT/SPARROW grade bands on the 1..10 numeric scale, highest first. `min`
 * is the inclusive lower bound; `null` marks the catch-all lowest band. This
 * table is the ONE source of truth: `bandForGrade` below reads it, and
 * GET /v1/hrms/apar/:id returns it as `gradeBands` so the detail page prints
 * the scale from the API instead of keeping its own hard-coded copy
 * (GAP-HR-APAR-DETAIL-05). Changing a cut-off needs HR sign-off first.
 */
export const GRADE_BANDS: ReadonlyArray<{ band: AparBand; min: number | null }> = [
  { band: "Outstanding", min: 9 },
  { band: "Very Good", min: 7 },
  { band: "Good", min: 5 },
  { band: "Average", min: 4 },
  { band: "Below Average", min: null },
];

export function bandForGrade(grade: number): AparBand {
  for (const b of GRADE_BANDS) {
    if (b.min === null || grade >= b.min) return b.band;
  }
  return "Below Average";
}

export function computeOverallGrade(scores: ScoreInput[]): GradeResult {
  if (scores.length === 0) {
    throw new Error("cannot compute grade with zero attribute scores");
  }
  let weightedSum = 0;
  let totalWeight = 0;
  for (const s of scores) {
    const w = s.weight > 0 ? s.weight : 1;
    weightedSum += s.score * w;
    totalWeight += w;
  }
  const raw = weightedSum / totalWeight;
  const overallGrade = Math.round(raw * 100) / 100;
  return {
    overallGrade,
    band: bandForGrade(overallGrade),
    totalWeight,
    attributeCount: scores.length,
  };
}
