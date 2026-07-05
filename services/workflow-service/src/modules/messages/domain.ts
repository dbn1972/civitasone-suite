/**
 * Messages domain — pure logic for message/signal intermediate catch events.
 *
 * A "message" is a correlated async event: an instance waits for a SPECIFIC
 * message (identified by name + correlationKey). Only ONE subscription matches.
 *
 * A "signal" is a broadcast: ALL active subscriptions for a signal name in a
 * tenant are matched simultaneously.
 *
 * Lifecycle: active → matched (payload delivered, task auto-completes)
 *                   → expired (timeout elapsed, timeout path taken)
 */

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export type SubscriptionStatus = "active" | "matched" | "expired";

/**
 * Validate message name: non-empty, alphanumeric + dots/underscores/hyphens.
 * BPMN message names are typically like "payment.confirmed" or "invoice_received".
 */
export function assertValidMessageName(name: string): void {
  if (!name || name.length === 0 || name.length > 128) {
    throw new DomainError("INVALID_MESSAGE_NAME", "message name must be 1-128 characters");
  }
  if (!/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(name)) {
    throw new DomainError("INVALID_MESSAGE_NAME", "message name must start with a letter and contain only alphanumeric, dot, underscore, or hyphen");
  }
}

/**
 * Validate signal name: same rules as message name.
 */
export function assertValidSignalName(name: string): void {
  if (!name || name.length === 0 || name.length > 128) {
    throw new DomainError("INVALID_SIGNAL_NAME", "signal name must be 1-128 characters");
  }
  if (!/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(name)) {
    throw new DomainError("INVALID_SIGNAL_NAME", "signal name must start with a letter and contain only alphanumeric, dot, underscore, or hyphen");
  }
}

/**
 * Validate correlation key: non-empty, max 256 chars. Can be any string
 * (e.g. an order ID, invoice number, etc.)
 */
export function assertValidCorrelationKey(key: string): void {
  if (!key || key.length === 0 || key.length > 256) {
    throw new DomainError("INVALID_CORRELATION_KEY", "correlation key must be 1-256 characters");
  }
}

/**
 * Resolve a correlation key expression against an instance context.
 * Expression is a simple dot-path into the context object (e.g. "order.id").
 * Returns the string value or throws if unresolvable.
 */
export function resolveCorrelationKey(
  expression: string,
  context: Record<string, unknown>,
): string {
  const parts = expression.split(".");
  let current: unknown = context;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      throw new DomainError("CORRELATION_UNRESOLVABLE", `cannot resolve '${expression}' in context`);
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (current === null || current === undefined) {
    throw new DomainError("CORRELATION_UNRESOLVABLE", `'${expression}' resolved to null/undefined`);
  }
  return String(current);
}

/**
 * Compute timeout timestamp from minutes (optional). Returns null if no timeout.
 */
export function computeTimeoutAt(timeoutMinutes: number | null | undefined, from: Date = new Date()): Date | null {
  if (timeoutMinutes === null || timeoutMinutes === undefined || timeoutMinutes <= 0) return null;
  return new Date(from.getTime() + timeoutMinutes * 60_000);
}

/**
 * Determine if a subscription has expired.
 */
export function isExpired(timeoutAt: Date | null, now: Date = new Date()): boolean {
  if (!timeoutAt) return false;
  return now >= timeoutAt;
}
