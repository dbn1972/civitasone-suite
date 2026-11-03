// Dependency-free so any helper (and any test that mocks browserClient) can use it.

/**
 * An Error whose `message` is already standard, plain-language copy and safe
 * to render as-is. Carries the support `reference` (correlation / request id)
 * separately so UI can show it as a secondary "Reference: XXXX" line, never as
 * the main message.
 */
export class UserFacingError extends Error {
  readonly reference: string | null;
  constructor(message: string, reference: string | null = null) {
    super(message);
    this.name = "UserFacingError";
    this.reference = reference;
  }

  /** Wrap an already-resolved message (e.g. useFormError's FormErrorState) so it survives a rethrow. */
  static from(state: { message: string; reference?: string | null }): UserFacingError {
    return new UserFacingError(state.message, state.reference ?? null);
  }
}

/**
 * The messages browsers (and node fetch in tests) use when fetch() never got a response.
 * Chrome/Edge: "Failed to fetch"; Firefox: "NetworkError when attempting to fetch resource.";
 * Safari: "Load failed"; undici: "fetch failed"; React Native/polyfills: "Network request failed".
 * "no response" is what our own offline-queue callers throw when fetchOrQueue got no Response.
 */
const FETCH_FAILURE_MESSAGE = /failed to fetch|networkerror|load failed|fetch failed|network request failed|network error|^no response$/i; // status-leak-ok: matches browser fetch() rejection text; never rendered

/**
 * True only for a genuine browser-side network failure: fetch() rejected before any
 * response arrived (offline, DNS, dropped connection), or the browser reports it is
 * offline. A TypeError thrown by a bug in our own code ("Cannot read properties of
 * undefined") is NOT a network failure, so the user is never told to check an internet
 * connection that is working. Aborts and timeouts are classified separately.
 */
export function isNetworkFailure(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  if (name === "NetworkError") return true;
  if (err instanceof TypeError) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
    return FETCH_FAILURE_MESSAGE.test(err.message);
  }
  return false;
}

/**
 * True for a request abandoned because it took too long: a TimeoutError (AbortSignal.timeout)
 * or an AbortError whose reason is a TimeoutError. A plain AbortError is a cancel (see isUserAbort).
 * browserFetch turns its own timer into a UserFacingError with the timeout copy.
 */
export function isTimeoutFailure(err: unknown): boolean {
  const e = err as { name?: unknown; cause?: { name?: unknown } } | null;
  if (e?.name === "TimeoutError") return true;
  return e?.name === "AbortError" && e.cause?.name === "TimeoutError";
}

/** True for a request the user or a navigation cancelled: nothing went wrong, so nothing is shown. */
export function isUserAbort(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === "AbortError" && !isTimeoutFailure(err);
}

/** How a thrown value should be explained to the user ("aborted" means: show nothing). */
export type ThrownKind = "userFacing" | "network" | "timeout" | "aborted" | "unknown";

export function classifyThrown(err: unknown): ThrownKind {
  if (err instanceof UserFacingError) return "userFacing";
  if (isNetworkFailure(err)) return "network";
  if (isTimeoutFailure(err)) return "timeout";
  if (isUserAbort(err)) return "aborted";
  return "unknown";
}

/** The support reference a thrown value carries, if it is a UserFacingError. */
export function referenceFromError(err: unknown): string | null {
  return err instanceof UserFacingError ? err.reference : null;
}
