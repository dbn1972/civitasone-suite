/**
 * predictive/domain.ts — CR-AI-01 pure helpers for predictive model scores.
 *
 * The single most important rule in this module: a numeric(12,4) score is a
 * DECIMAL STRING from end to end. Postgres returns numeric as a string, and we
 * keep it as a string in JSON. Casting to a JS `number` would silently drop
 * precision for large LTV magnitudes (2^53 limit) and re-introduce binary
 * float rounding on values such as 0.1 — which is exactly the class of bug
 * that makes two systems disagree about a customer's lifetime value.
 *
 * Consequently every normalisation here is pure string arithmetic. No IO.
 */

export type SubjectType = "profile" | "account" | "deal";
export type ModelType = "ltv" | "renewal" | "fraud" | "churn";

export const SUBJECT_TYPES: readonly SubjectType[] = ["profile", "account", "deal"];
export const MODEL_TYPES: readonly ModelType[] = ["ltv", "renewal", "fraud", "churn"];

/** Matches numeric(12,4): 8 integer digits + 4 fractional digits. */
export const SCORE_SCALE = 4;
export const SCORE_INTEGER_DIGITS = 8;

/** Matches numeric(5,4): confidence is a probability in 0.0000 – 1.0000. */
export const CONFIDENCE_SCALE = 4;

export function isSubjectType(value: string): value is SubjectType {
  return (SUBJECT_TYPES as readonly string[]).includes(value);
}

export function isModelType(value: string): value is ModelType {
  return (MODEL_TYPES as readonly string[]).includes(value);
}

/** A decimal literal, optionally signed, with an optional fractional part. */
const DECIMAL_RE = /^[+-]?(\d+)(?:\.(\d*))?$/;

export interface DecimalParts {
  negative: boolean;
  integer: string;
  fraction: string;
}

/**
 * Split a decimal string into its parts without touching floating point.
 * Returns null when the input is not a plain decimal literal (exponent
 * notation is rejected on purpose: "1e3" from a client is ambiguous input, not
 * a score).
 */
export function parseDecimal(value: string): DecimalParts | null {
  const match = DECIMAL_RE.exec(value.trim());
  if (match === null) return null;
  const integer = (match[1] ?? "").replace(/^0+(?=\d)/, "");
  const fraction = match[2] ?? "";
  return { negative: value.trim().startsWith("-"), integer, fraction };
}

/**
 * Render a decimal value at exactly `scale` fractional digits.
 *
 * Strings are re-scaled by padding/truncating the fraction — no float involved,
 * so "9999999.99995" keeps every digit it is allowed to keep. Numbers go
 * through toFixed, which is the best available for an input that has already
 * lost precision by being a JS number.
 *
 * Returns null when the value is not a usable decimal.
 */
export function normaliseDecimal(value: string | number, scale: number): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value.toFixed(scale);
  }

  const parts = parseDecimal(value);
  if (parts === null) return null;

  // Truncate rather than round: a score is a measurement, and silently rounding
  // up a fraud score at the boundary would change a business decision.
  const fraction = parts.fraction.slice(0, scale).padEnd(scale, "0");
  const sign = parts.negative && !isZero(parts.integer, fraction) ? "-" : "";
  return scale === 0 ? `${sign}${parts.integer}` : `${sign}${parts.integer}.${fraction}`;
}

function isZero(integer: string, fraction: string): boolean {
  return /^0*$/.test(integer) && /^0*$/.test(fraction);
}

/**
 * Compare two decimal strings numerically without converting to float.
 * Returns -1, 0 or 1. Used to rank scores and to apply minScore filters.
 */
export function compareDecimal(a: string, b: string): number {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  if (pa === null || pb === null) return 0;

  const negA = pa.negative && !isZero(pa.integer, pa.fraction);
  const negB = pb.negative && !isZero(pb.integer, pb.fraction);
  if (negA !== negB) return negA ? -1 : 1;

  const width = Math.max(pa.integer.length, pb.integer.length);
  const intA = pa.integer.padStart(width, "0");
  const intB = pb.integer.padStart(width, "0");
  const fracWidth = Math.max(pa.fraction.length, pb.fraction.length);
  const fracA = pa.fraction.padEnd(fracWidth, "0");
  const fracB = pb.fraction.padEnd(fracWidth, "0");

  const left = intA + fracA;
  const right = intB + fracB;
  const magnitude = left === right ? 0 : left > right ? 1 : -1;

  // Both negative: the larger magnitude is the smaller number.
  return negA ? -magnitude : magnitude;
}

export interface PredictiveScoreInput {
  subjectType: string;
  subjectId: string;
  modelType: string;
  score: string | number;
  confidence?: string | number | undefined;
}

/**
 * Validate an upsert payload. Returns null when valid, otherwise a human
 * message suitable for a 422 response.
 */
export function validatePredictiveScore(input: PredictiveScoreInput): string | null {
  if (!isSubjectType(input.subjectType)) return `unknown subjectType: ${input.subjectType}`;
  if (!isModelType(input.modelType)) return `unknown modelType: ${input.modelType}`;

  const score = normaliseDecimal(input.score, SCORE_SCALE);
  if (score === null) return "score must be a decimal value";

  const parts = parseDecimal(score);
  if (parts !== null && parts.integer.length > SCORE_INTEGER_DIGITS) {
    return `score must not exceed ${SCORE_INTEGER_DIGITS} integer digits`;
  }

  if (input.confidence !== undefined) {
    const confidence = normaliseDecimal(input.confidence, CONFIDENCE_SCALE);
    if (confidence === null) return "confidence must be a decimal value";
    if (compareDecimal(confidence, "0") < 0 || compareDecimal(confidence, "1") > 0) {
      return "confidence must be between 0 and 1";
    }
  }

  return null;
}

/**
 * Rank scores highest-first using decimal comparison, with a stable tie-break on
 * subjectId so repeated calls always return the same order.
 */
export function rankByScore<T extends { score: string; subjectId: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const byScore = compareDecimal(b.score, a.score);
    if (byScore !== 0) return byScore;
    return a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0;
  });
}
