/**
 * visitor-service: badge-print — pure domain logic.
 *
 * Owns:
 *   - Print job status state machine (queued → in_progress → completed/failed)
 *   - Priority queue scoring logic for Redis SORTED SET ordering
 *   - Retry logic with exponential backoff (30s, 60s, 120s), max 3 retries
 *   - Template versioning logic (create new version from current)
 *
 * All functions are pure (no side effects, no DB/Redis calls). Scoring uses
 * numeric values suitable for Redis ZADD where lower score = higher priority.
 *
 * Requirements validated: 5.2, 5.4, 5.5, 5.6, 5.7, 4.6
 */

// ---------------------------------------------------------------------------
// Print Job State Machine
// ---------------------------------------------------------------------------

/** Valid statuses for a print job lifecycle. */
export type PrintJobStatus = "queued" | "in_progress" | "completed" | "failed";

/**
 * Allowed state transitions for print job lifecycle.
 *
 * - queued → in_progress (device picks up job) or failed (pre-delivery failure)
 * - in_progress → completed (device acknowledges success), failed (device reports error),
 *   or queued (retry — job is re-enqueued for another attempt)
 * - completed → (terminal state, no further transitions)
 * - failed → (terminal state after max retries; admin can manually re-queue via a new job)
 */
export const PRINT_JOB_TRANSITIONS: Record<PrintJobStatus, PrintJobStatus[]> = {
  queued: ["in_progress", "failed"],
  in_progress: ["completed", "failed", "queued"], // queued = retry
  completed: [], // terminal
  failed: [], // terminal (after max retries)
};

/**
 * Determine whether a print job state transition is valid.
 *
 * @param from - Current print job status
 * @param to - Desired target status
 * @returns true if the transition is allowed by the state machine
 */
export function canTransitionJob(from: PrintJobStatus, to: PrintJobStatus): boolean {
  const allowed = PRINT_JOB_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

// ---------------------------------------------------------------------------
// Priority Queue Scoring Logic
// ---------------------------------------------------------------------------

/** Supported print job priority levels. */
export type PrintPriority = "standard" | "high";

/**
 * Base offset for standard priority jobs in the Redis sorted set.
 * High priority jobs use 0 as their base, so they always sort before standard ones.
 */
const STANDARD_PRIORITY_BASE = 1_000_000_000;

/**
 * Compute the score for a print job in a Redis SORTED SET.
 *
 * Lower score = higher priority (Redis ZRANGEBYSCORE returns lowest first).
 * Within the same priority tier, FIFO ordering is achieved by using the
 * creation timestamp as a fractional component.
 *
 * Scoring formula:
 * - high priority:     0 + (createdAt epoch seconds)
 * - standard priority: 1,000,000,000 + (createdAt epoch seconds)
 *
 * This guarantees all high-priority jobs sort before any standard-priority job,
 * and within each tier, earlier jobs are served first.
 *
 * @param priority - The print job priority level
 * @param createdAt - The timestamp when the job was created
 * @returns A numeric score suitable for Redis ZADD
 */
export function computeJobScore(priority: PrintPriority, createdAt: Date): number {
  const timestampSeconds = createdAt.getTime() / 1000;
  const base = priority === "high" ? 0 : STANDARD_PRIORITY_BASE;
  return base + timestampSeconds;
}

// ---------------------------------------------------------------------------
// Retry Logic with Exponential Backoff
// ---------------------------------------------------------------------------

/** Maximum number of retry attempts before a print job is marked as failed. */
export const MAX_RETRIES = 3;

/**
 * Exponential backoff delays for each retry attempt (in milliseconds).
 * - Retry 1: 30 seconds
 * - Retry 2: 60 seconds
 * - Retry 3: 120 seconds
 */
export const RETRY_DELAYS_MS = [30_000, 60_000, 120_000] as const;

/**
 * Determine whether a print job should be retried based on the current retry count.
 *
 * A job is eligible for retry if it has been attempted fewer than MAX_RETRIES times.
 *
 * @param retryCount - The number of retry attempts already made (0-based)
 * @returns true if the job can be retried again
 */
export function shouldRetry(retryCount: number): boolean {
  return retryCount < MAX_RETRIES;
}

/**
 * Get the delay (in milliseconds) before the next retry attempt.
 *
 * Uses the exponential backoff schedule defined in RETRY_DELAYS_MS.
 * If retryCount exceeds the defined delays, the last delay value is used.
 *
 * @param retryCount - The current retry count (0-based: 0 = first retry, 1 = second, etc.)
 * @returns Delay in milliseconds before the next retry attempt
 */
export function getNextRetryDelay(retryCount: number): number {
  if (retryCount < 0) return RETRY_DELAYS_MS[0] ?? 0;
  if (retryCount >= RETRY_DELAYS_MS.length) {
    return RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 0;
  }
  return RETRY_DELAYS_MS[retryCount] ?? 0;
}

/**
 * Compute the absolute timestamp for the next retry attempt.
 *
 * Adds the appropriate backoff delay to the current time.
 *
 * @param retryCount - The current retry count (0-based: 0 = first retry, 1 = second, etc.)
 * @param now - Current time (injectable for deterministic testing)
 * @returns The Date at which the next retry should be attempted
 */
export function computeNextRetryAt(retryCount: number, now: Date = new Date()): Date {
  const delayMs = getNextRetryDelay(retryCount);
  return new Date(now.getTime() + delayMs);
}

// ---------------------------------------------------------------------------
// Template Versioning Logic
// ---------------------------------------------------------------------------

/**
 * Create a new template version from the current template record.
 *
 * Increments the template version number and records a reference to the previous
 * version for audit trail and rollback support.
 *
 * @param current - The current template record containing its version number and ID
 * @returns Object with the new version number and a reference to the previous version ID
 */
export function createNewVersion(current: { templateVersion: number; id: string }): {
  templateVersion: number;
  previousVersionId: string;
} {
  return {
    templateVersion: current.templateVersion + 1,
    previousVersionId: current.id,
  };
}
