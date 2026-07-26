/**
 * SVC-050 GeM / CPPP integration — pure domain logic for the exchange +
 * reconciliation state machine, retry policy, and status reconciliation.
 */

export class GemIntegrationError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "GemIntegrationError";
  }
}

export const PROVIDERS = ["gem", "cppp", "gepnic"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const ENTITY_TYPES = ["tender", "order", "aoc", "award", "bid"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const DIRECTIONS = ["outbound", "inbound"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** pending → sent → acked → reconciled | failed. */
export type RefStatus = "pending" | "sent" | "acked" | "failed" | "reconciled";

export const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * A pending/failed ref may be retried while it has remaining attempts. An acked
 * or reconciled ref is terminal for the exchange phase.
 */
export function shouldRetry(status: string, attempts: number, maxAttempts = DEFAULT_MAX_ATTEMPTS): boolean {
  if (status === "acked" || status === "reconciled") return false;
  return attempts < maxAttempts;
}

/** Exponential backoff (ms) for the Nth attempt (0-based), capped at 5 min. */
export function backoffMs(attempt: number, baseMs = 1000): number {
  return Math.min(baseMs * 2 ** Math.max(0, attempt), 5 * 60_000);
}

/**
 * Fold the result of an exchange attempt into the next ref state.
 *  - success → sent + external ref/status, cleared error
 *  - failure → attempts+1; failed once attempts exhaust the retry budget,
 *    otherwise stays pending for the next retry.
 */
export interface ExchangeOutcome {
  status: RefStatus;
  attempts: number;
  externalRef: string | null;
  externalStatus: string | null;
  lastError: string | null;
}

export function foldExchangeResult(
  currentAttempts: number,
  result: { ok: true; externalRef: string; externalStatus: string } | { ok: false; error: string },
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): ExchangeOutcome {
  if (result.ok) {
    return {
      status: "sent", attempts: currentAttempts + 1,
      externalRef: result.externalRef, externalStatus: result.externalStatus, lastError: null,
    };
  }
  const attempts = currentAttempts + 1;
  return {
    status: attempts >= maxAttempts ? "failed" : "pending",
    attempts, externalRef: null, externalStatus: null, lastError: result.error,
  };
}

/**
 * Reconcile a locally-tracked ref against the provider's reported status.
 * A terminal-accepted external status marks the ref reconciled; a rejection
 * marks it failed; anything else leaves it acked pending a later pass. Never
 * fabricates success — an unknown/empty external status is NOT reconciled.
 */
export interface ReconcileResult {
  status: RefStatus;
  externalStatus: string | null;
  reconciled: boolean;
  discrepancy: boolean;
}

const ACCEPTED_EXTERNAL = ["accepted", "confirmed", "completed", "placed", "published", "awarded"];
const REJECTED_EXTERNAL = ["rejected", "failed", "cancelled"];

export function reconcile(externalStatus: string | null | undefined): ReconcileResult {
  const s = (externalStatus ?? "").toLowerCase().trim();
  if (s && ACCEPTED_EXTERNAL.includes(s)) {
    return { status: "reconciled", externalStatus: s, reconciled: true, discrepancy: false };
  }
  if (s && REJECTED_EXTERNAL.includes(s)) {
    return { status: "failed", externalStatus: s, reconciled: false, discrepancy: true };
  }
  // Unknown / in-flight / empty → honest: not reconciled, no fake success.
  return { status: "acked", externalStatus: s || null, reconciled: false, discrepancy: false };
}
