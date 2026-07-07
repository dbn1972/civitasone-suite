/**
 * Retry logic with exponential backoff for payment gateway calls.
 *
 * Policy:
 * - Max 3 attempts (initial + 2 retries)
 * - Backoff intervals: 1s, 2s, 4s
 * - Retry ONLY on transient errors (5xx / network timeout)
 * - No retry on 4xx (client errors) — fail immediately
 *
 * Requirements: 13.7, 13.8
 */

import { GatewayError } from "./types.js";

const BACKOFF_INTERVALS_MS = [1000, 2000, 4000] as const;
const MAX_ATTEMPTS = 3;

export interface RetryOptions {
  /** Override default backoff intervals (ms) for testing */
  backoffMs?: readonly number[];
  /** Override max attempts for testing */
  maxAttempts?: number;
}

/**
 * Execute a gateway call with exponential backoff retry.
 *
 * - On transient failure (5xx/timeout): retries up to maxAttempts with exponential backoff.
 * - On client error (4xx): throws immediately without retry.
 * - On success: returns the result.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? MAX_ATTEMPTS;
  const backoffMs = opts?.backoffMs ?? BACKOFF_INTERVALS_MS;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;

      // If it's a GatewayError with a 4xx status, do NOT retry
      if (err instanceof GatewayError && err.isClientError) {
        throw err;
      }

      // If we have more attempts, wait and retry
      if (attempt < maxAttempts - 1) {
        const delay = backoffMs[attempt] ?? backoffMs[backoffMs.length - 1] ?? 4000;
        await sleep(delay);
      }
    }
  }

  // All attempts exhausted
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
