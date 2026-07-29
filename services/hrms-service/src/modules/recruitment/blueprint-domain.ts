/**
 * Assessment blueprint & question-bank domain (pure). No I/O, no Date.now.
 *
 *  - QTYPES / DIFFICULTIES / TIE_BREAK_RULES: the controlled vocabularies
 *    (R-RA-0123 assessment types).
 *  - validateScoringConfig: blocks INVALID scoring combinations before a
 *    blueprint can be activated (R-RA-0125 — negative marking, section cut-offs,
 *    total cut-off, tie-break).
 *  - validateBlueprintDraft: structural validation of a blueprint definition.
 *  - questionReadyToValidate: a question may only move draft -> validated when its
 *    answer key / options are complete for its type (R-RA-0121 validated bank).
 */

export const QTYPES = ["mcq", "descriptive", "case_study", "coding", "file_upload", "psychometric"] as const;
export type QType = (typeof QTYPES)[number];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Tie-break primitives an administrator may order (R-RA-0125). */
export const TIE_BREAK_RULES = [
  "higher_total",
  "higher_section",
  "fewer_negatives",
  "older_dob",
  "earlier_submit",
  "higher_qualification",
] as const;
export type TieBreakRule = (typeof TIE_BREAK_RULES)[number];

export interface DifficultyMix { easy?: number; medium?: number; hard?: number }

export interface SectionConfig {
  key: string;
  title?: string;
  questionCount: number;
  marksPerQuestion: number;
  sectionCutoffPct?: number;      // per-section qualifying % (optional)
  difficultyMix?: DifficultyMix;  // counts by difficulty; must sum to questionCount if given
}

export interface NegativeMarking {
  enabled: boolean;
  fraction?: number;              // fraction of a question's marks deducted per wrong answer, 0..1
}

export interface ScoringConfig {
  totalCutoffPct?: number;        // overall qualifying %, 0..100
  negativeMarking?: NegativeMarking;
  sections?: SectionConfig[];
  tieBreak?: string[];            // ordered tie-break rule keys (subset of TIE_BREAK_RULES, unique)
}

function isNum(x: unknown): x is number { return typeof x === "number" && Number.isFinite(x); }
function pct(x: unknown): boolean { return isNum(x) && x >= 0 && x <= 100; }

/**
 * Return a list of human-readable errors for a scoring configuration. An empty
 * array means the configuration is internally consistent and may be activated.
 * INVALID COMBINATIONS ARE REJECTED (R-RA-0125) rather than silently coerced.
 */
export function validateScoringConfig(cfg: ScoringConfig | undefined | null): string[] {
  const errors: string[] = [];
  if (!cfg || typeof cfg !== "object") return ["scoring config is required"];

  if (cfg.totalCutoffPct !== undefined && !pct(cfg.totalCutoffPct)) {
    errors.push("totalCutoffPct must be between 0 and 100");
  }

  if (cfg.negativeMarking?.enabled) {
    const f = cfg.negativeMarking.fraction;
    if (!isNum(f) || f <= 0 || f > 1) {
      errors.push("negativeMarking.fraction must be between 0 (exclusive) and 1 when negative marking is enabled");
    }
  }

  const sections = cfg.sections ?? [];
  if (sections.length === 0) {
    errors.push("at least one section is required");
  }
  const seenKeys = new Set<string>();
  let totalMarks = 0;
  for (const [i, s] of sections.entries()) {
    const label = s.key || `#${i + 1}`;
    if (!s.key || !s.key.trim()) errors.push(`section ${label}: key is required`);
    else if (seenKeys.has(s.key)) errors.push(`section ${label}: duplicate section key`);
    else seenKeys.add(s.key);

    if (!Number.isInteger(s.questionCount) || s.questionCount <= 0) {
      errors.push(`section ${label}: questionCount must be a positive integer`);
    }
    if (!isNum(s.marksPerQuestion) || s.marksPerQuestion <= 0) {
      errors.push(`section ${label}: marksPerQuestion must be greater than 0`);
    }
    if (s.sectionCutoffPct !== undefined && !pct(s.sectionCutoffPct)) {
      errors.push(`section ${label}: sectionCutoffPct must be between 0 and 100`);
    }
    if (s.difficultyMix) {
      const mix = (s.difficultyMix.easy ?? 0) + (s.difficultyMix.medium ?? 0) + (s.difficultyMix.hard ?? 0);
      for (const d of DIFFICULTIES) {
        const v = s.difficultyMix[d];
        if (v !== undefined && (!Number.isInteger(v) || v < 0)) {
          errors.push(`section ${label}: difficultyMix.${d} must be a non-negative integer`);
        }
      }
      if (Number.isInteger(s.questionCount) && s.questionCount > 0 && mix !== s.questionCount) {
        errors.push(`section ${label}: difficultyMix must sum to questionCount (${mix} != ${s.questionCount})`);
      }
    }
    if (isNum(s.marksPerQuestion) && Number.isInteger(s.questionCount) && s.questionCount > 0 && s.marksPerQuestion > 0) {
      totalMarks += s.questionCount * s.marksPerQuestion;
    }
  }
  if (sections.length > 0 && totalMarks <= 0) {
    errors.push("total marks across sections must be greater than 0");
  }

  if (cfg.tieBreak) {
    if (!Array.isArray(cfg.tieBreak)) {
      errors.push("tieBreak must be an ordered list");
    } else {
      const seen = new Set<string>();
      for (const r of cfg.tieBreak) {
        if (!(TIE_BREAK_RULES as readonly string[]).includes(r)) errors.push(`tieBreak: unknown rule "${r}"`);
        if (seen.has(r)) errors.push(`tieBreak: duplicate rule "${r}"`);
        seen.add(r);
      }
    }
  }

  return errors;
}

/** Total marks implied by a scoring config's sections (0 if none). */
export function totalMarks(cfg: ScoringConfig | undefined | null): number {
  let t = 0;
  for (const s of cfg?.sections ?? []) {
    if (isNum(s.marksPerQuestion) && Number.isInteger(s.questionCount) && s.questionCount > 0 && s.marksPerQuestion > 0) {
      t += s.questionCount * s.marksPerQuestion;
    }
  }
  return t;
}

export interface BlueprintDraft {
  code?: string;
  title?: string;
  competencies?: unknown;
  allowedTypes?: unknown;
  durationMinutes?: unknown;
  scoringConfig?: ScoringConfig;
}

/** Structural validation of a blueprint. Empty array = ready to activate. */
export function validateBlueprintDraft(b: BlueprintDraft): string[] {
  const errors: string[] = [];
  if (!b.code || !String(b.code).trim()) errors.push("code is required");
  if (!b.title || !String(b.title).trim()) errors.push("title is required");

  const comps = Array.isArray(b.competencies) ? b.competencies : [];
  if (comps.length === 0) errors.push("at least one competency is required");

  const types = Array.isArray(b.allowedTypes) ? (b.allowedTypes as string[]) : [];
  if (types.length === 0) errors.push("at least one assessment type is required");
  for (const t of types) {
    if (!(QTYPES as readonly string[]).includes(t)) errors.push(`unknown assessment type "${t}"`);
  }

  if (!isNum(b.durationMinutes) || (b.durationMinutes as number) <= 0) {
    errors.push("durationMinutes must be greater than 0");
  }

  errors.push(...validateScoringConfig(b.scoringConfig));
  return errors;
}

export interface QuestionView {
  qtype: string;
  stem?: string | null;
  topic?: string | null;
  difficulty?: string | null;
  marks?: number | null;
  options?: unknown;
  answerKey?: Record<string, unknown> | null;
}

/**
 * May a question move draft -> validated? Its answer key / options must be
 * complete for its type (R-RA-0121). Returns errors; empty = ready.
 */
export function questionReadyToValidate(q: QuestionView): string[] {
  const errors: string[] = [];
  if (!q.stem || !String(q.stem).trim()) errors.push("stem is required");
  if (!q.topic || !String(q.topic).trim()) errors.push("topic is required");
  if (!q.difficulty || !(DIFFICULTIES as readonly string[]).includes(q.difficulty)) errors.push("valid difficulty is required");
  if (!isNum(q.marks) || (q.marks as number) <= 0) errors.push("marks must be greater than 0");
  if (!(QTYPES as readonly string[]).includes(q.qtype)) { errors.push(`unknown type "${q.qtype}"`); return errors; }

  const ak = (q.answerKey ?? {}) as Record<string, unknown>;
  const opts = Array.isArray(q.options) ? (q.options as Array<{ id?: string }>) : [];

  switch (q.qtype as QType) {
    case "mcq": {
      if (opts.length < 2) errors.push("mcq requires at least 2 options");
      const ids = new Set(opts.map((o) => o?.id).filter(Boolean) as string[]);
      if (ids.size !== opts.length) errors.push("mcq option ids must be present and unique");
      const correct = Array.isArray(ak.correct) ? (ak.correct as string[]) : [];
      if (correct.length === 0) errors.push("mcq requires at least one correct answer in answerKey.correct");
      for (const c of correct) if (!ids.has(c)) errors.push(`mcq answerKey.correct references unknown option "${c}"`);
      break;
    }
    case "coding":
      if (!ak.testCasesRef) errors.push("coding requires answerKey.testCasesRef");
      break;
    case "descriptive":
    case "case_study":
      if (!ak.rubricRef && !ak.rubric) errors.push(`${q.qtype} requires an evaluation rubric (answerKey.rubricRef)`);
      break;
    case "psychometric":
      if (!ak.scoringKeyRef) errors.push("psychometric requires answerKey.scoringKeyRef");
      break;
    case "file_upload":
      // Manually evaluated; no machine answer key required.
      break;
  }
  return errors;
}
