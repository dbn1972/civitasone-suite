/** Exponential backoff with jitter for pipeline retries (pure; `rand` injectable for tests). */
export interface BackoffOptions { baseMs?: number; maxMs?: number; jitter?: number; rand?: () => number }

/** attempt is 1-based (the attempt that just failed). Delay = min(max, base * 2^(attempt-1)) +/- jitter. */
export function backoffMs(attempt: number, opts: BackoffOptions = {}): number {
  const base = opts.baseMs ?? 30_000;
  const max = opts.maxMs ?? 15 * 60_000;
  const jitter = opts.jitter ?? 0.3;
  const rand = opts.rand ?? Math.random;
  const raw = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  const spread = raw * jitter;
  return Math.max(0, Math.round(raw - spread + rand() * 2 * spread));
}

export function nextAttemptAt(now: Date, attempt: number, opts?: BackoffOptions): Date {
  return new Date(now.getTime() + backoffMs(attempt, opts));
}
