/**
 * Post-processing of @civitasone/ocr `classifyWithPreset` (operator preset decides docType; the classifier only
 * cross-checks). The package flags `uncertain` on a confident disagreement (different top type, relative margin
 * >= uncertainMargin, raw score >= the type's minScore). The tenant setting `classification.minScore` (0..1) adds
 * a floor on the classifier's own CONFIDENCE for that disagreement to count; below it the preset stands.
 * Candidates are trimmed to the top 2 for persistence (review API / WEB shows them).
 */
import type { Classification } from "./ocr-contract.js";

export interface ClassificationCandidate { docType: string; label: string; score: number }
export interface ClassificationDetail extends Classification {
  /** Operator preset that decided docType (null/absent: the classifier decided). */
  presetDocType?: string | null;
  /** Top-2 classifier candidates by raw score (always present when the classifier ran). */
  candidates?: ClassificationCandidate[];
}

export function refinePreset(
  r: ClassificationDetail & { presetDocType: string | null; candidates: ClassificationCandidate[] },
  classifierConfidence: number,
  minScore: number,
): ClassificationDetail {
  const candidates = [...r.candidates].sort((a, b) => b.score - a.score).slice(0, 2);
  if (!r.presetDocType) return { ...r, candidates };
  const disagree = r.uncertain && classifierConfidence >= minScore;
  return {
    ...r, candidates, uncertain: disagree,
    confidence: disagree ? r.confidence : Math.max(r.confidence, 0.9),
    evidence: disagree || !r.uncertain ? r.evidence : [...r.evidence, `disagreement-below-minScore(${classifierConfidence})`],
  };
}
