/**
 * DigiLocker adapter — identity document verification.
 *
 * Env-gated: fails closed when DIGILOCKER_ENABLED !== 'true'.
 * All outbound HTTP calls are wrapped with @civitasone/circuit-breaker
 * (5 consecutive failures → open for 30s).
 *
 * Env vars:
 *   DIGILOCKER_ENABLED     — "true" to activate; anything else → fail-closed
 *   DIGILOCKER_BASE_URL    — Base URL for the DigiLocker API (default "https://api.digilocker.gov.in")
 *   DIGILOCKER_CLIENT_ID   — Client ID used for bearer authentication
 *   DIGILOCKER_TIMEOUT_MS  — Outbound HTTP timeout in ms (default 10000)
 *
 * DPDP data minimization: only `docType` + `verifiedAt` are ever returned/persisted.
 * The document content itself is never retained (Property 14).
 * No PII is logged — only status codes and outcome.
 */

import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";

// ── Config ────────────────────────────────────────────────────────

const DIGILOCKER_ENABLED = process.env.DIGILOCKER_ENABLED === "true";
const DIGILOCKER_BASE_URL = process.env.DIGILOCKER_BASE_URL ?? "https://api.digilocker.gov.in";
const DIGILOCKER_CLIENT_ID = process.env.DIGILOCKER_CLIENT_ID ?? "";
const DIGILOCKER_TIMEOUT_MS = Number(process.env.DIGILOCKER_TIMEOUT_MS ?? "10000");

// ── Circuit Breaker ───────────────────────────────────────────────
// 5 consecutive failures → open for 30s (per steering rules).

const breaker = new CircuitBreaker({
  name: "digilocker",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

// ── Types ─────────────────────────────────────────────────────────

export type DigiLockerResult =
  | { status: "verified"; docType: string; verifiedAt: Date }
  | { status: "failed"; reason: string }
  | { status: "unavailable"; fallbackToManual: true };

// ── Helpers ───────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIGILOCKER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Verify an identity document via DigiLocker.
 *
 * Fail-closed behavior:
 * - Returns `{ status: "unavailable", fallbackToManual: true }` when
 *   `DIGILOCKER_ENABLED` is not "true", or when the circuit breaker is open.
 * - Returns `{ status: "failed", reason }` for any other error (HTTP error,
 *   timeout, network failure) while the breaker is closed/half-open.
 * - Returns `{ status: "verified", docType, verifiedAt }` on success. Only
 *   the document type and verification timestamp are ever surfaced/persisted —
 *   never the document content (DPDP data minimization, Property 14).
 */
export async function verifyDocument(uri: string): Promise<DigiLockerResult> {
  if (!DIGILOCKER_ENABLED) {
    return { status: "unavailable", fallbackToManual: true };
  }

  try {
    const response = await breaker.call(async () => {
      const res = await fetchWithTimeout(`${DIGILOCKER_BASE_URL}/v3/document/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${DIGILOCKER_CLIENT_ID}`,
        },
        body: JSON.stringify({ uri }),
      });

      if (!res.ok) {
        throw new Error(`DigiLocker HTTP ${res.status}`);
      }

      return res.json() as Promise<{ docType?: string }>;
    });

    return {
      status: "verified",
      docType: response.docType ?? "unknown",
      verifiedAt: new Date(),
    };
  } catch (err: unknown) {
    // Circuit open (either rejected immediately, or this call just tripped it) — fail-closed.
    if (err instanceof CircuitBreakerOpenError || breaker.state === "open") {
      return { status: "unavailable", fallbackToManual: true };
    }
    return { status: "failed", reason: (err as Error).message };
  }
}

/** Returns the current state of the circuit breaker. */
export function getBreakerState(): "closed" | "open" | "half-open" {
  return breaker.state;
}

/** Returns true if the adapter is enabled and configured. */
export function isEnabled(): boolean {
  return DIGILOCKER_ENABLED;
}
