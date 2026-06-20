/** SQS DelaySeconds for retries 1, 2, 3 — 15m, 60m, 240m. */
export const RETRY_DELAY_SECONDS = [900, 3600, 14400] as const;
export const MAX_DELIVERY_RETRIES = 3;

export function retryDelaySeconds(retryCount: number): number {
  const idx = Math.min(Math.max(retryCount, 0), RETRY_DELAY_SECONDS.length - 1);
  return RETRY_DELAY_SECONDS[idx]!;
}

export function computeNextRetryAt(retryCount: number, now = new Date()): Date {
  const delayMs = retryDelaySeconds(retryCount) * 1000;
  return new Date(now.getTime() + delayMs);
}

export function shouldRetry(retryCount: number): boolean {
  return retryCount < MAX_DELIVERY_RETRIES;
}
