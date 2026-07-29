/**
 * Assessment runtime domain (pure). No I/O, no Date.now / Math.random — every
 * function is deterministic given its inputs so crash-recovery reproduces exactly.
 *
 *  - randomizeQuestionOrder: a per-candidate deterministic shuffle (R-RA-0124).
 *    Seeded by the attempt id so the SAME order is regenerated on recovery.
 *  - effectiveDurationMs / attemptDeadline: personal timer with reasonable
 *    accommodation / extra time (R-RA-0127).
 *  - scoreObjective: auto-evaluation of objective/coding responses (R-RA-0131).
 *  - computeAttemptResult: aggregate section + total scores against the blueprint
 *    cut-offs to a provisional qualified / not_qualified / withheld result.
 */

// ---- deterministic PRNG (xmur3 seed + mulberry32) -----------------------

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}
function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic Fisher-Yates shuffle of question ids, seeded by `seed`
 * (the attempt id). Same seed + same ids => same order, so recovery is stable
 * and each candidate gets a distinct order (R-RA-0124). Does not mutate input.
 */
export function randomizeQuestionOrder(questionIds: readonly string[], seed: string): string[] {
  const out = [...questionIds];
  const seedFn = xmur3(seed);
  const rand = mulberry32(seedFn());
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = out[i]!, b = out[j]!;
    out[i] = b; out[j] = a;
  }
  return out;
}

// ---- timing / accommodation ---------------------------------------------

/** Effective attempt duration in ms including accommodation extra time. */
export function effectiveDurationMs(durationMinutes: number, extraTimePct = 0): number {
  const pct = Number.isFinite(extraTimePct) && extraTimePct > 0 ? extraTimePct : 0;
  return Math.round(durationMinutes * (1 + pct / 100) * 60_000);
}

/**
 * Personal deadline (ms epoch) for an attempt that started at `startedAtMs`.
 * It is the personal timer (start + effective duration incl. accommodation), but
 * never runs past the scheduling window's end PLUS only the granted extra time —
 * so a candidate starting near a short window's close cannot run far beyond it,
 * while an accommodation candidate still keeps their extra time (R-RA-0127).
 * When `windowEndMs` is omitted there is no window cap.
 */
export function attemptDeadline(startedAtMs: number, durationMinutes: number, extraTimePct = 0, windowEndMs?: number): number {
  const personal = startedAtMs + effectiveDurationMs(durationMinutes, extraTimePct);
  if (windowEndMs == null) return personal;
  const grantedExtraMs = effectiveDurationMs(durationMinutes, extraTimePct) - effectiveDurationMs(durationMinutes, 0);
  return Math.min(personal, windowEndMs + grantedExtraMs);
}

// ---- objective auto-scoring (R-RA-0131) ---------------------------------

export interface PaperEntry {
  questionId: string;
  section: string;
  marks: number;
  qtype: string;
  answerKey?: Record<string, unknown> | null;
}
export type NegativeMarking = { enabled: boolean; fraction?: number };

export interface ObjectiveScore { score: number; isCorrect: boolean | null; auto: boolean }

/** Two decimal rounding, half-up, for a marks value. */
function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

/** True set equality — dedupes both sides so a padded/duplicated selection
 *  (e.g. ["a","a","a"] against correct ["a","b","c"]) can never score full marks. */
function sameSet(a: string[], b: string[]): boolean {
  const sa = new Set(a), sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

/**
 * Auto-score a single response. Returns `auto: false` (score 0, isCorrect null)
 * for types that require human/manual evaluation (descriptive, case_study,
 * file_upload, psychometric) — those are settled in the moderation stage.
 *
 * Only MCQ is machine-scored here: full marks only when the selected option set
 * exactly equals the correct set; a non-empty wrong answer incurs negative
 * marking when enabled; a blank answer scores 0 with no penalty.
 *
 * Coding is NOT auto-scored from the response: the candidate submits code only,
 * and test-case pass/fail must be produced by a TRUSTED execution service with a
 * per-test-case audit (R-RA-0131) — never taken from client-supplied {passed,
 * total}. Until that trusted runner stamps a verified result (a follow-up), coding
 * — like descriptive / case_study / file_upload / psychometric — is held for
 * evaluation (auto=false), which withholds the provisional result.
 */
export function scoreObjective(entry: PaperEntry, response: Record<string, unknown> | null | undefined, neg: NegativeMarking | undefined): ObjectiveScore {
  const marks = entry.marks;
  const r = response ?? {};
  switch (entry.qtype) {
    case "mcq": {
      const correct = Array.isArray(entry.answerKey?.correct) ? (entry.answerKey!.correct as string[]) : [];
      const selected = Array.isArray((r as { selected?: unknown }).selected) ? ((r as { selected: unknown[] }).selected as string[]) : [];
      if (selected.length === 0) return { score: 0, isCorrect: false, auto: true };
      if (sameSet(correct, selected)) return { score: round2(marks), isCorrect: true, auto: true };
      const penalty = neg?.enabled && neg.fraction ? round2(marks * neg.fraction) : 0;
      return { score: round2(-penalty), isCorrect: false, auto: true };
    }
    default:
      // coding | descriptive | case_study | file_upload | psychometric -> manual /
      // trusted-runner evaluation. Never trust client-supplied scores.
      return { score: 0, isCorrect: null, auto: false };
  }
}

// ---- result aggregation --------------------------------------------------

export interface SectionCutoff { key: string; sectionCutoffPct?: number }
export interface AttemptScoreResult {
  totalScore: number;
  maxScore: number;
  sectionScores: Record<string, { score: number; max: number }>;
  needsManualEval: boolean;
  result: "qualified" | "not_qualified" | "withheld";
}

/**
 * Aggregate per-question scores into section + total scores and decide a
 * provisional result against the blueprint cut-offs. If any question needs
 * manual evaluation the result is `withheld` (settled after moderation).
 */
export function computeAttemptResult(
  paper: readonly PaperEntry[],
  scored: ReadonlyMap<string, ObjectiveScore>,
  cutoffs: { totalCutoffPct?: number; sections?: readonly SectionCutoff[] },
): AttemptScoreResult {
  const sectionScores: Record<string, { score: number; max: number }> = {};
  let totalScore = 0, maxScore = 0, needsManual = false;

  for (const e of paper) {
    const s = scored.get(e.questionId);
    const sec = (sectionScores[e.section] ??= { score: 0, max: 0 });
    sec.max += e.marks; maxScore += e.marks;
    if (!s || !s.auto) { needsManual = true; continue; }
    sec.score += s.score; totalScore += s.score;
  }
  totalScore = round2(totalScore); maxScore = round2(maxScore);
  for (const k of Object.keys(sectionScores)) {
    sectionScores[k]!.score = round2(sectionScores[k]!.score);
  }

  if (needsManual) return { totalScore, maxScore, sectionScores, needsManualEval: true, result: "withheld" };

  // Section cut-offs first, then total cut-off. A cut-off is a % of that scope's max.
  const cutoffMap = new Map((cutoffs.sections ?? []).map((s) => [s.key, s.sectionCutoffPct]));
  let qualified = true;
  for (const [key, sc] of Object.entries(sectionScores)) {
    const pct = cutoffMap.get(key);
    if (pct != null && sc.max > 0 && (sc.score / sc.max) * 100 < pct) qualified = false;
  }
  if (cutoffs.totalCutoffPct != null && maxScore > 0 && (totalScore / maxScore) * 100 < cutoffs.totalCutoffPct) qualified = false;

  return { totalScore, maxScore, sectionScores, needsManualEval: false, result: qualified ? "qualified" : "not_qualified" };
}
