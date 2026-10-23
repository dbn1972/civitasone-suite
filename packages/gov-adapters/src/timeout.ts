/**
 * Shared bounded-fetch helper for the government gateway adapters (CLOS2-S6-12).
 *
 * A stalled gateway that accepts the connection and never replies must not hang the
 * caller. Every outbound call carries an AbortSignal.timeout; on expiry the adapter
 * throws its own typed timeout error. For calls that WRITE (disburse, file) the
 * upstream may still have executed the request, so those errors carry
 * `outcomeUnknown: true`: callers must reconcile via the status endpoint (using the
 * same txnRef / filing reference) before any retry, and must never auto-retry blindly.
 */

export const DEFAULT_GATEWAY_TIMEOUT_MS = 30_000;

/** Positive integer ms from the named env var, else the default. Read at call time. */
export function timeoutFromEnv(name: string, fallback = DEFAULT_GATEWAY_TIMEOUT_MS): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function isTimeoutAbort(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  onTimeout: (timeoutMs: number) => Error,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (isTimeoutAbort(err)) throw onTimeout(timeoutMs);
    throw err;
  }
}
