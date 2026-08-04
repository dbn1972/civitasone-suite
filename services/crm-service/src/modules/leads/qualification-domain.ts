/**
 * LQ-001 — pure lead qualification scoring.
 *
 * Given a framework's questions and a lead's answers, compute a 0–100 qualification
 * score and a categorical outcome. No DB, no I/O — unit-testable.
 *
 * Per-question scoring is driven by `outcomeRule`, interpreted by answer type:
 *  - bool   : { whenTrue, whenFalse }         → raw score for the boolean answer
 *  - select : { options: { value: score }, default? } → raw score for the chosen option
 *  - number : { tiers: [{ min, score }], default? }   → highest tier whose min ≤ value
 * Each raw score is clamped to [0,100], weighted, and normalised by the total weight.
 */

export type AnswerType = "bool" | "select" | "number";

export interface QualificationQuestion {
  id: string;
  answerType: AnswerType;
  /** Relative importance (0–100). Questions with weight 0 do not affect the score. */
  weight: number;
  outcomeRule: Record<string, unknown>;
  order?: number;
}

export type Answer = boolean | string | number | null | undefined;
export type Answers = Record<string, Answer>;

export type Outcome = "qualified" | "nurture" | "disqualified";

export interface QualificationResult {
  score: number; // 0–100
  outcome: Outcome;
  /** Per-question partial (raw) scores, for explainability. */
  factors: Record<string, number>;
}

/** Default outcome thresholds on the 0–100 score. */
export const OUTCOME_THRESHOLDS = { qualified: 70, nurture: 40 } as const;

function clamp(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/** Raw 0–100 score for one question given its answer. Missing answer → 0. */
export function scoreAnswer(q: QualificationQuestion, answer: Answer): number {
  const rule = q.outcomeRule ?? {};
  switch (q.answerType) {
    case "bool": {
      const truthy = answer === true || answer === "true" || answer === 1;
      const whenTrue = Number(rule.whenTrue ?? 100);
      const whenFalse = Number(rule.whenFalse ?? 0);
      return clamp(truthy ? whenTrue : whenFalse);
    }
    case "select": {
      const options = (rule.options as Record<string, number> | undefined) ?? {};
      if (answer == null) return clamp(Number(rule.default ?? 0));
      const key = String(answer);
      if (Object.prototype.hasOwnProperty.call(options, key)) return clamp(Number(options[key]));
      return clamp(Number(rule.default ?? 0));
    }
    case "number": {
      if (answer == null || answer === "") return clamp(Number(rule.default ?? 0));
      const val = Number(answer);
      if (Number.isNaN(val)) return clamp(Number(rule.default ?? 0));
      const tiers = ((rule.tiers as Array<{ min: number; score: number }> | undefined) ?? [])
        .slice()
        .sort((a, b) => a.min - b.min);
      let best = Number(rule.default ?? 0);
      for (const t of tiers) {
        if (val >= Number(t.min)) best = Number(t.score);
      }
      return clamp(best);
    }
    default:
      return 0;
  }
}

/** Map a 0–100 score to a categorical outcome using the default thresholds. */
export function outcomeFromScore(score: number): Outcome {
  if (score >= OUTCOME_THRESHOLDS.qualified) return "qualified";
  if (score >= OUTCOME_THRESHOLDS.nurture) return "nurture";
  return "disqualified";
}

/**
 * Compute the qualification score + outcome for a lead.
 *
 * score = sum(weight * scoreAnswer) / sum(weight), rounded, clamped to [0,100].
 * Edge cases: no questions, or all weights zero → score 0 → disqualified.
 */
export function computeQualification(
  questions: readonly QualificationQuestion[],
  answers: Answers,
): QualificationResult {
  const factors: Record<string, number> = {};
  let weightedSum = 0;
  let totalWeight = 0;
  for (const q of questions) {
    const raw = scoreAnswer(q, answers[q.id]);
    factors[q.id] = raw;
    const w = Math.max(0, q.weight);
    weightedSum += w * raw;
    totalWeight += w;
  }
  const score = totalWeight === 0 ? 0 : clamp(Math.round(weightedSum / totalWeight));
  return { score, outcome: outcomeFromScore(score), factors };
}
