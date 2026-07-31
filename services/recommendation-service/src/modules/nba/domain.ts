/**
 * nba/domain.ts — Pure recommendation scoring, ranking and status transitions.
 *
 * No IO. Every function is deterministic for a given input so the ranking a
 * client sees can be reproduced offline for audit / model-debugging purposes.
 */

export type RecommendationStatus = "served" | "accepted" | "rejected" | "expired";

export const RECOMMENDATION_STATUSES: readonly RecommendationStatus[] = [
  "served",
  "accepted",
  "rejected",
  "expired",
];

/** Statuses that end the lifecycle — no further transition is permitted. */
export const TERMINAL_STATUSES: readonly RecommendationStatus[] = ["accepted", "rejected", "expired"];

/** Allowed state machine: served → accepted | rejected | expired. */
const ALLOWED_TRANSITIONS: Record<RecommendationStatus, readonly RecommendationStatus[]> = {
  served: ["accepted", "rejected", "expired"],
  accepted: [],
  rejected: [],
  expired: [],
};

/** How long a served recommendation stays actionable, in hours. */
export const DEFAULT_TTL_HOURS = 72;

/** Matrix priorities at or above this value count as maximum importance. */
export const MAX_MATRIX_PRIORITY = 10;

/**
 * Relative contribution of each signal to the final score. Sums to 1 so the
 * result is always within 0..1 without a second normalisation pass.
 */
export const SCORE_WEIGHTS = {
  matrixPriority: 0.5,
  healthScore: 0.2,
  affinity: 0.3,
} as const;

export interface ScoreInput {
  /** Cross-sell matrix priority (0 = lowest). Capped at MAX_MATRIX_PRIORITY. */
  matrixPriority: number;
  /** Account health score (0–100) from the health module. */
  healthScore: number;
  /** Product affinity for this profile (0–1). */
  affinity: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Round to 4 decimal places to match the numeric(5,4) score column. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function isRecommendationStatus(value: string): value is RecommendationStatus {
  return (RECOMMENDATION_STATUSES as readonly string[]).includes(value);
}

export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * Combine matrix priority, account health and product affinity into a single
 * relevance score in the 0..1 range, rounded to 4 decimal places.
 */
export function scoreRecommendation(input: ScoreInput): number {
  const priority = clamp(input.matrixPriority, 0, MAX_MATRIX_PRIORITY) / MAX_MATRIX_PRIORITY;
  const health = clamp(input.healthScore, 0, 100) / 100;
  const affinity = clamp(input.affinity, 0, 1);

  const raw =
    priority * SCORE_WEIGHTS.matrixPriority +
    health * SCORE_WEIGHTS.healthScore +
    affinity * SCORE_WEIGHTS.affinity;

  return round4(clamp(raw, 0, 1));
}

export interface RankableRecommendation {
  /** Relevance score (0..1). Higher wins. */
  score: number;
  /** Optional matrix priority used only as a tie-break. Higher wins. */
  priority?: number;
}

/**
 * Sort by score descending, tie-break on priority descending, then cap the
 * result at `limit`. The input array is never mutated.
 */
export function rankRecommendations<T extends RankableRecommendation>(
  items: readonly T[],
  limit: number,
): T[] {
  const cap = Number.isFinite(limit) ? Math.floor(limit) : 0;
  if (cap <= 0) return [];

  const sorted = [...items].sort((a, b) => {
    const scoreA = Number.isFinite(a.score) ? a.score : 0;
    const scoreB = Number.isFinite(b.score) ? b.score : 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    const priorityA = Number.isFinite(a.priority) ? (a.priority as number) : 0;
    const priorityB = Number.isFinite(b.priority) ? (b.priority as number) : 0;
    return priorityB - priorityA;
  });

  return sorted.slice(0, cap);
}

/**
 * Validate a status change against the state machine.
 * Returns null when the transition is allowed, otherwise a human message.
 */
export function validateStatusTransition(from: string, to: string): string | null {
  if (!isRecommendationStatus(from)) return `unknown current status: ${from}`;
  if (!isRecommendationStatus(to)) return `unknown target status: ${to}`;
  if (isTerminalStatus(from)) return `recommendation is already ${from} and cannot be changed`;
  if (from === to) return `recommendation is already ${from}`;
  if (!ALLOWED_TRANSITIONS[from].includes(to)) return `cannot transition from ${from} to ${to}`;
  return null;
}

/**
 * True when a served recommendation has passed its TTL and should no longer be
 * actionable. A non-positive or non-finite TTL means "never expires".
 */
export function isExpired(
  servedAt: Date | string,
  ttlHours: number = DEFAULT_TTL_HOURS,
  now: Date = new Date(),
): boolean {
  if (!Number.isFinite(ttlHours) || ttlHours <= 0) return false;

  const servedMs = servedAt instanceof Date ? servedAt.getTime() : Date.parse(servedAt);
  if (!Number.isFinite(servedMs)) return false;

  return now.getTime() >= servedMs + ttlHours * 3_600_000;
}

/** Earliest servedAt that is still inside the TTL window — used for SQL filters. */
export function ttlCutoff(ttlHours: number = DEFAULT_TTL_HOURS, now: Date = new Date()): Date {
  const hours = Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours : DEFAULT_TTL_HOURS;
  return new Date(now.getTime() - hours * 3_600_000);
}
