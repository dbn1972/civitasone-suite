/**
 * Shared error-translation helper for command consumers.
 *
 * Every module defines its own `DomainError` class in its `domain.ts` (they
 * are intentionally separate types, not subclasses of a common base — see
 * each module's domain.ts), so this helper takes the module's own class as a
 * parameter rather than importing one specific module's DomainError. That
 * keeps the `instanceof` check exactly as strict as it was when each
 * consumer.ts defined this locally: only the caller's own DomainError class
 * converts to a NonRetryableError, everything else rethrows unchanged.
 */
import { NonRetryableError } from "@civitasone/queue";

/** A DomainError-shaped class: `extends Error`, constructible, nothing more assumed. */
type DomainErrorClass = abstract new (...args: never[]) => Error;

/**
 * Convert a caught error to a NonRetryableError when it is an instance of
 * the given DomainError class (a validation/business-rule rejection that
 * retrying can never fix); rethrow anything else unchanged so the queue's
 * normal retry/dead-letter handling still applies.
 *
 * Always throws — the `never` return type lets callers write
 * `catch (err) { toDomainError(err, DomainError); }` without an explicit
 * `return`/`throw` after it.
 */
export function toDomainError(err: unknown, DomainError: DomainErrorClass): never {
  if (err instanceof DomainError) throw new NonRetryableError(err.message);
  throw err as Error;
}
