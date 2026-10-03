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

/** True for a fetch that never got a response (offline, DNS, CORS, abort, timeout). */
export function isNetworkFailure(err: unknown): boolean {
  if (err instanceof TypeError) return true; // fetch rejects with TypeError("Failed to fetch")
  const name = (err as { name?: unknown } | null)?.name;
  return name === "AbortError" || name === "TimeoutError" || name === "NetworkError";
}

/** The support reference a thrown value carries, if it is a UserFacingError. */
export function referenceFromError(err: unknown): string | null {
  return err instanceof UserFacingError ? err.reference : null;
}
