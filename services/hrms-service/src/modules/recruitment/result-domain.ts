/**
 * Assessment result-finalisation domain (pure). Evaluation aggregation,
 * moderation/normalisation/scaling, and the post-moderation result decision.
 *
 *  - aggregateEvaluations: mean of the anonymised evaluator scores for one
 *    manual question (R-RA-0132).
 *  - consolidatedScores: merge machine (objective) + manual scores into the
 *    scored map computeAttemptResult expects — all entries now resolved.
 *  - validateModeration / applyModeration: normalisation / scaling with bounds
 *    (R-RA-0133).
 *  - resultAfterModeration: section cut-offs stay a hard gate; moderation only
 *    adjusts the total against the total cut-off.
 */
import type { PaperEntry, ObjectiveScore } from "./attempt-domain.js";

function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

export const MODERATION_METHODS = ["none", "scale", "grace"] as const;
export type ModerationMethod = (typeof MODERATION_METHODS)[number];
export interface Moderation { method: ModerationMethod; factor?: number; notes?: string }

/** Mean of evaluator scores for a question (0 if none), rounded to 2dp. */
export function aggregateEvaluations(scores: readonly number[]): number {
  if (scores.length === 0) return 0;
  return round2(scores.reduce((a, b) => a + b, 0) / scores.length);
}

/**
 * Build the scored map computeAttemptResult expects, merging machine-scored
 * objective questions with resolved manual scores. Every paper entry is marked
 * auto=true here (all resolved), so the result is no longer withheld.
 * `manualByQ` MUST contain a score for every non-objective question.
 */
export function consolidatedScores(
  paper: readonly PaperEntry[],
  objectiveByQ: ReadonlyMap<string, ObjectiveScore>,
  manualByQ: ReadonlyMap<string, number>,
): { scored: Map<string, ObjectiveScore>; missing: string[] } {
  const scored = new Map<string, ObjectiveScore>();
  const missing: string[] = [];
  for (const e of paper) {
    const obj = objectiveByQ.get(e.questionId);
    if (obj && obj.auto) { scored.set(e.questionId, obj); continue; }
    const m = manualByQ.get(e.questionId);
    if (m == null) { missing.push(e.questionId); continue; }
    scored.set(e.questionId, { score: round2(m), isCorrect: null, auto: true });
  }
  return { scored, missing };
}

/** Errors for a moderation spec (empty = valid). Invalid combos are rejected. */
export function validateModeration(mod: Moderation): string[] {
  const errors: string[] = [];
  if (!(MODERATION_METHODS as readonly string[]).includes(mod.method)) errors.push(`unknown moderation method "${mod.method}"`);
  if (mod.method === "scale") {
    if (typeof mod.factor !== "number" || !Number.isFinite(mod.factor) || mod.factor <= 0 || mod.factor > 5) errors.push("scale factor must be > 0 and <= 5");
  }
  if (mod.method === "grace") {
    if (typeof mod.factor !== "number" || !Number.isFinite(mod.factor) || mod.factor < 0) errors.push("grace marks must be >= 0");
  }
  return errors;
}

/** Apply moderation to a raw total, clamped to [0, maxScore]. */
export function applyModeration(rawScore: number, maxScore: number, mod: Moderation): number {
  let out = rawScore;
  if (mod.method === "scale") out = rawScore * (mod.factor ?? 1);
  else if (mod.method === "grace") out = rawScore + (mod.factor ?? 0);
  return round2(Math.max(0, Math.min(maxScore, out)));
}

export interface SectionScore { score: number; max: number }

/**
 * Final result after moderation. Section cut-offs remain a HARD gate evaluated on
 * the (un-moderated) section scores; moderation only lifts the TOTAL against the
 * total cut-off. A candidate who missed a section cut-off stays not_qualified.
 */
export function resultAfterModeration(
  sectionScores: Record<string, SectionScore>,
  cutoffs: { totalCutoffPct?: number; sections?: ReadonlyArray<{ key: string; sectionCutoffPct?: number }> },
  moderatedTotal: number,
  maxScore: number,
): "qualified" | "not_qualified" {
  const cutoffMap = new Map((cutoffs.sections ?? []).map((s) => [s.key, s.sectionCutoffPct]));
  for (const [key, sc] of Object.entries(sectionScores)) {
    const pct = cutoffMap.get(key);
    if (pct != null && sc.max > 0 && (sc.score / sc.max) * 100 < pct) return "not_qualified";
  }
  if (cutoffs.totalCutoffPct != null && maxScore > 0 && (moderatedTotal / maxScore) * 100 < cutoffs.totalCutoffPct) return "not_qualified";
  return "qualified";
}
