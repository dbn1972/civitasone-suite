/**
 * A bounded, cancellable poll for estab writes that are accepted (202) and
 * applied asynchronously by a consumer. The caller shows what it knows, then
 * asks `check` up to `maxAttempts` times, `intervalMs` apart, until the change
 * is visible.
 *
 *  - `check` returns the resolved value, or null when the change is not visible yet
 *    (a thrown error counts as "not yet", so a flaky read never ends the poll early).
 *  - `onResolved` runs once with that value; `onExhausted` runs once when every
 *    attempt came back empty. Neither runs after `cancel()`.
 *  - It returns `cancel`, which stops the timer and suppresses both callbacks, so
 *    a component can cancel on unmount (no timer or callback outlives the page).
 *
 * Plain timers, no React: no side effect ever runs inside a state updater.
 */
export type BoundedPollOptions<T> = {
  check: (attempt: number) => Promise<T | null>;
  onResolved: (value: T) => void;
  onExhausted: () => void;
  intervalMs?: number;
  maxAttempts?: number;
};

export const POLL_INTERVAL_MS = 1000;
export const POLL_MAX_ATTEMPTS = 5;

export function startBoundedPoll<T>(opts: BoundedPollOptions<T>): () => void {
  const intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS;
  const maxAttempts = opts.maxAttempts ?? POLL_MAX_ATTEMPTS;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (attempt: number) => {
    timer = setTimeout(() => {
      void (async () => {
        let found: T | null = null;
        try {
          found = await opts.check(attempt);
        } catch {
          found = null;
        }
        if (cancelled) return;
        if (found !== null) {
          opts.onResolved(found);
        } else if (attempt < maxAttempts) {
          schedule(attempt + 1);
        } else {
          opts.onExhausted();
        }
      })();
    }, intervalMs);
  };

  schedule(1);
  return () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
