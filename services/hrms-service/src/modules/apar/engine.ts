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

/** DoPT/SPARROW grade bands on the 1..10 numeric scale. */
export function bandForGrade(grade: number): AparBand {
  if (grade >= 9) return "Outstanding";
  if (grade >= 7) return "Very Good";
  if (grade >= 5) return "Good";
  if (grade >= 4) return "Average";
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
