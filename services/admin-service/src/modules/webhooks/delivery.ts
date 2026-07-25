/**
 * CAP-054 webhook delivery domain — pure functions (no I/O).
 *
 * Owns the delivery lifecycle: retry backoff schedule, HTTP-response
 * classification, the delivery state machine, dedup-key derivation, and
 * replay-eligibility. The consumer/adapter perform the actual HTTP POST and
 * persistence; all decisions live here so they are unit-testable without a
 * live endpoint or database.
 */

export type DeliveryStatus =
  | "pending"      // queued, not yet attempted
  | "delivering"   // attempt in flight
  | "delivered"    // 2xx received
  | "failed"       // attempt failed, retry scheduled
  | "exhausted";   // retries exhausted (or permanent failure), terminal

/** Outcome of a single HTTP delivery attempt. */
export type AttemptOutcome = "delivered" | "retryable" | "permanent";

/** Default maximum delivery attempts (initial + retries). */
export const MAX_ATTEMPTS = 5;

/**
 * Exponential backoff schedule (seconds) applied AFTER attempt N fails.
 * Index 0 → delay after the 1st attempt, etc. 1m, 5m, 15m, 1h, 6h.
 */
export const RETRY_BACKOFF_SECONDS = [60, 300, 900, 3600, 21600] as const;

/** Delay in seconds before the next attempt, given how many attempts have run. */
export function retryDelaySeconds(attempt: number): number {
  if (attempt < 1) return RETRY_BACKOFF_SECONDS[0];
  const idx = Math.min(attempt - 1, RETRY_BACKOFF_SECONDS.length - 1);
  return RETRY_BACKOFF_SECONDS[idx]!;
}

/** True while more attempts remain. */
export function shouldRetry(attempt: number, maxAttempts: number = MAX_ATTEMPTS): boolean {
  return attempt < maxAttempts;
}

/** Absolute time of the next retry, or null when no retry should happen. */
export function computeNextRetryAt(
  attempt: number,
  now: Date,
  maxAttempts: number = MAX_ATTEMPTS,
): Date | null {
  if (!shouldRetry(attempt, maxAttempts)) return null;
  return new Date(now.getTime() + retryDelaySeconds(attempt) * 1000);
}

/**
 * Classify an HTTP response (or transport error) into an attempt outcome.
 * - 2xx                       → delivered
 * - 408/429/5xx/no-status     → retryable (transient)
 * - other 4xx                 → permanent (client rejected; do not retry)
 */
export function classifyResponse(statusCode: number | null | undefined): AttemptOutcome {
  if (statusCode == null) return "retryable"; // timeout / network error
  if (statusCode >= 200 && statusCode < 300) return "delivered";
  if (statusCode === 408 || statusCode === 429 || statusCode >= 500) return "retryable";
  return "permanent";
}

export interface DeliveryTransition {
  status: DeliveryStatus;
  /** Next retry time, or null when terminal (delivered/exhausted). */
  nextRetryAt: Date | null;
}

/**
 * Advance the delivery state machine after an attempt.
 *
 * @param outcome     classified result of the attempt just made
 * @param attempt     the attempt number that just completed (1-based)
 * @param now         reference time for scheduling
 * @param maxAttempts cap on total attempts
 */
export function nextDeliveryState(
  outcome: AttemptOutcome,
  attempt: number,
  now: Date,
  maxAttempts: number = MAX_ATTEMPTS,
): DeliveryTransition {
  if (outcome === "delivered") {
    return { status: "delivered", nextRetryAt: null };
  }
  if (outcome === "permanent") {
    return { status: "exhausted", nextRetryAt: null };
  }
  // retryable
  const nextRetryAt = computeNextRetryAt(attempt, now, maxAttempts);
  if (nextRetryAt === null) {
    return { status: "exhausted", nextRetryAt: null };
  }
  return { status: "failed", nextRetryAt };
}

/** Terminal states — no further automatic delivery attempts occur. */
export function isTerminal(status: DeliveryStatus): boolean {
  return status === "delivered" || status === "exhausted";
}

/**
 * Stable dedup key for a source event → endpoint delivery. The DB enforces
 * uniqueness via a partial index; this mirrors that key for app-layer checks
 * and logging. Returns null when there is no source event id to dedup on.
 */
export function makeDedupKey(webhookId: string, eventId: string | null | undefined): string | null {
  if (!eventId) return null;
  return `${webhookId}:${eventId}`;
}

/**
 * A delivery may be replayed only once it has reached a terminal state
 * (delivered, or exhausted after failures). In-flight/pending deliveries are
 * not replayable — the in-flight attempt owns the outcome.
 */
export function canReplay(status: DeliveryStatus): boolean {
  return status === "delivered" || status === "exhausted" || status === "failed";
}
