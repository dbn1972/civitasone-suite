/**
 * Survey & Sampling domain — pure functions for sampling algorithms,
 * response validation, and aggregation computation.
 *
 * No side effects, no DB access, no I/O. Fully deterministic and property-testable.
 * Sampling functions are deterministic given a seed (seeded PRNG).
 *
 * _Requirements: SVC-104_
 */

import type { QuestionnaireItem } from "./schema.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Valid survey states and permitted transitions. */
export const SURVEY_STATES = ["draft", "active", "closed"] as const;
export type SurveyState = typeof SURVEY_STATES[number];

/** Permitted state transitions for surveys: draft → active → closed */
export const SURVEY_TRANSITIONS: Record<SurveyState, SurveyState[]> = {
  draft:  ["active"],
  active: ["closed"],
  closed: [],
};

export type SamplingMethod = "random" | "stratified" | "systematic";

export interface StratifiedEntity {
  id: string;
  [key: string]: unknown;
}

export interface QuestionSummary {
  mean?: number;
  mode?: string | number;
  distribution?: Record<string, number>;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

// ── Seeded PRNG (Mulberry32) ──────────────────────────────────────────────────

/**
 * Mulberry32 seeded PRNG. Returns a function that yields a float in [0, 1).
 * Deterministic given the same seed.
 */
export function createSeededRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Sampling Functions ────────────────────────────────────────────────────────

/**
 * Select a random sample using Fisher-Yates shuffle with seeded PRNG.
 * Returns the first `sampleSize` elements after shuffling.
 *
 * @param entityIds - Full population of entity IDs.
 * @param sampleSize - Number of elements to select.
 * @param seed - Numeric seed for deterministic selection.
 * @returns Selected entity IDs.
 */
export function selectRandomSample(
  entityIds: string[],
  sampleSize: number,
  seed: number,
): string[] {
  if (sampleSize <= 0) return [];
  if (sampleSize >= entityIds.length) return [...entityIds];

  const rng = createSeededRng(seed);
  const arr = [...entityIds];

  // Fisher-Yates shuffle
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }

  return arr.slice(0, sampleSize);
}

/**
 * Select a stratified sample — proportional allocation per stratum.
 * Groups entities by the stratification field, then takes a proportional
 * sample from each stratum.
 *
 * @param entities - Full population with their stratification values.
 * @param stratificationField - Key to group entities by.
 * @param sampleSizePercent - Percentage of each stratum to sample (0-100).
 * @param seed - Numeric seed for deterministic selection.
 * @returns Selected entity IDs.
 */
export function selectStratifiedSample(
  entities: StratifiedEntity[],
  stratificationField: string,
  sampleSizePercent: number,
  seed: number,
): string[] {
  if (entities.length === 0 || sampleSizePercent <= 0) return [];
  if (sampleSizePercent >= 100) return entities.map((e) => e.id);

  // Group by stratum
  const strata = new Map<string, string[]>();
  for (const entity of entities) {
    const key = String(entity[stratificationField] ?? "unknown");
    const group = strata.get(key) ?? [];
    group.push(entity.id);
    strata.set(key, group);
  }

  const rng = createSeededRng(seed);
  const selected: string[] = [];

  // Proportional allocation: take ceil(stratum.length * percent / 100) from each
  for (const [, ids] of strata) {
    const stratumSampleSize = Math.max(1, Math.ceil(ids.length * sampleSizePercent / 100));
    const actual = Math.min(stratumSampleSize, ids.length);

    // Fisher-Yates on stratum
    const arr = [...ids];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
    selected.push(...arr.slice(0, actual));
  }

  return selected;
}

/**
 * Select a systematic sample — every kth element.
 * k = Math.floor(N / n). Start offset determined by seed.
 *
 * @param entityIds - Full population of entity IDs.
 * @param sampleSize - Number of elements to select.
 * @param seed - Numeric seed for deterministic start offset.
 * @returns Selected entity IDs.
 */
export function selectSystematicSample(
  entityIds: string[],
  sampleSize: number,
  seed: number,
): string[] {
  if (sampleSize <= 0) return [];
  if (sampleSize >= entityIds.length) return [...entityIds];

  const k = Math.floor(entityIds.length / sampleSize);
  if (k <= 0) return [...entityIds];

  const rng = createSeededRng(seed);
  const start = Math.floor(rng() * k);

  const selected: string[] = [];
  for (let i = start; i < entityIds.length && selected.length < sampleSize; i += k) {
    selected.push(entityIds[i]!);
  }

  return selected;
}

// ── Aggregation ───────────────────────────────────────────────────────────────

/**
 * Compute aggregation statistics for survey responses.
 * For each question:
 * - numeric fields: compute mean
 * - all fields: compute mode and distribution
 *
 * @param responses - Array of answer records (Record<questionId, value>).
 * @param questionnaire - The questionnaire definition (for field types).
 * @returns Record mapping questionId to summary statistics.
 */
export function computeAggregation(
  responses: Array<Record<string, unknown>>,
  questionnaire: QuestionnaireItem[],
): Record<string, QuestionSummary> {
  const summaries: Record<string, QuestionSummary> = {};

  for (const question of questionnaire) {
    const values: unknown[] = [];
    for (const response of responses) {
      const val = response[question.id];
      if (val !== undefined && val !== null) {
        values.push(val);
      }
    }

    const summary: QuestionSummary = {};

    // Distribution (frequency count)
    const distribution: Record<string, number> = {};
    for (const val of values) {
      const key = String(val);
      distribution[key] = (distribution[key] ?? 0) + 1;
    }
    summary.distribution = distribution;

    // Mode (most frequent value)
    if (values.length > 0) {
      let maxCount = 0;
      let modeValue: string | number = "";
      for (const [key, count] of Object.entries(distribution)) {
        if (count > maxCount) {
          maxCount = count;
          modeValue = key;
        }
      }
      summary.mode = modeValue;
    }

    // Mean (only for numeric field types)
    const numericTypes = ["number", "numeric", "rating", "scale"];
    if (numericTypes.includes(question.fieldType)) {
      const numericValues = values
        .map((v) => Number(v))
        .filter((n) => !Number.isNaN(n));
      if (numericValues.length > 0) {
        summary.mean = numericValues.reduce((sum, n) => sum + n, 0) / numericValues.length;
      }
    }

    summaries[question.id] = summary;
  }

  return summaries;
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Validate a survey response against the questionnaire definition.
 * Ensures all required questions are answered.
 *
 * @param answers - The submitted answers (Record<questionId, value>).
 * @param questionnaire - The questionnaire definition.
 * @throws {DomainError} with code `MISSING_REQUIRED_ANSWERS` if required questions are unanswered.
 */
export function validateSurveyResponse(
  answers: Record<string, unknown>,
  questionnaire: QuestionnaireItem[],
): void {
  const missingIds: string[] = [];

  for (const question of questionnaire) {
    if (question.required) {
      const val = answers[question.id];
      if (val === undefined || val === null || val === "") {
        missingIds.push(question.id);
      }
    }
  }

  if (missingIds.length > 0) {
    throw new DomainError(
      "MISSING_REQUIRED_ANSWERS",
      `Required questions not answered: ${missingIds.join(", ")}`,
    );
  }
}

/**
 * Assert that a survey state transition is valid.
 *
 * @param current - The current state.
 * @param target - The desired target state.
 * @throws {DomainError} with code `INVALID_TRANSITION`
 */
export function assertValidSurveyTransition(
  current: SurveyState,
  target: SurveyState,
): void {
  const allowed = SURVEY_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    throw new DomainError(
      "INVALID_TRANSITION",
      `Cannot transition survey from '${current}' to '${target}'. Allowed: [${allowed.join(", ")}]`,
    );
  }
}
