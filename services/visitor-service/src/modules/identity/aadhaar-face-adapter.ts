/**
 * Aadhaar face-match adapter — biometric identity verification (Requirement 8).
 *
 * Env-gated: fails closed when AADHAAR_FACE_MATCH_ENABLED !== 'true'.
 * All outbound HTTP calls are wrapped with @civitasone/circuit-breaker
 * (5 consecutive failures → open for 30s, per steering resilience rules).
 *
 * Env vars:
 *   AADHAAR_FACE_MATCH_ENABLED     — "true" to activate; anything else → fail-closed
 *   AADHAAR_FACE_MATCH_URL         — Base URL for the face-match API (default "https://api.uidai.gov.in")
 *   AADHAAR_FACE_MATCH_CLIENT_ID   — Client ID used for bearer authentication
 *   AADHAAR_FACE_MATCH_TIMEOUT_MS  — Outbound HTTP timeout in ms (default 15000)
 *
 * DPDP data minimization: the captured live photograph is submitted to the
 * external face-match endpoint for a single comparison and is NEVER persisted
 * by this adapter. Only the match result, confidence score, liveness flag,
 * and a timestamp are ever returned/persisted (Requirement 8.5). Callers
 * (consumer.ts) must not write the raw photograph to durable storage; any
 * photograph retained for a failed-match security incident is subject to
 * the 24h post-checkout deletion job (Requirement 8.5).
 * No PII is logged — only status codes and outcome.
 */

import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";

// ── Config ────────────────────────────────────────────────────────

const AADHAAR_FACE_MATCH_ENABLED = process.env.AADHAAR_FACE_MATCH_ENABLED === "true";
const AADHAAR_FACE_MATCH_URL = process.env.AADHAAR_FACE_MATCH_URL ?? "https://api.uidai.gov.in";
const AADHAAR_FACE_MATCH_CLIENT_ID = process.env.AADHAAR_FACE_MATCH_CLIENT_ID ?? "";
const AADHAAR_FACE_MATCH_TIMEOUT_MS = Number(process.env.AADHAAR_FACE_MATCH_TIMEOUT_MS ?? "15000");

/** Default confidence threshold (%) when a tenant has not configured an override (Requirement 8.2). */
export const DEFAULT_CONFIDENCE_THRESHOLD = 95;

// ── Circuit Breaker ───────────────────────────────────────────────
// 5 consecutive failures → open for 30s (per steering rules).

const breaker = new CircuitBreaker({
  name: "aadhaar-face-match",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

// ── Types ─────────────────────────────────────────────────────────

/** Input for a face-match attempt. `livePhotoBase64` is used transiently and never persisted. */
export interface AadhaarFaceMatchInput {
  /** Live photograph captured at the kiosk, base64-encoded. Never persisted by this adapter. */
  livePhotoBase64: string;
  /** Opaque Aadhaar reference/token to match against (never the raw Aadhaar number). */
  aadhaarRef: string;
}

export type AadhaarFaceMatchResult =
  | { status: "matched"; confidence: number; livenessPassed: boolean; matchedAt: Date }
  | { status: "not_matched"; confidence: number; livenessPassed: boolean; matchedAt: Date }
  | { status: "unavailable"; fallbackToManual: true };

interface FaceMatchApiResponse {
  confidence?: number;
  livenessPassed?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AADHAAR_FACE_MATCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Perform Aadhaar face matching for identity verification at check-in.
 *
 * @param input               Live photo (transient, never persisted) + Aadhaar reference.
 * @param confidenceThreshold Minimum confidence (%) required to pass, tenant-configurable
 *                            (Requirement 8.2). Defaults to {@link DEFAULT_CONFIDENCE_THRESHOLD}.
 *
 * Fail-closed behavior:
 * - Returns `{ status: "unavailable", fallbackToManual: true }` when
 *   `AADHAAR_FACE_MATCH_ENABLED` is not "true", or when the circuit breaker is open,
 *   or when the external call errors (timeout, network failure, non-2xx response).
 *   The adapter never fabricates a "matched" result on error.
 * - Returns `{ status: "matched", confidence, livenessPassed, matchedAt }` when the
 *   confidence score meets or exceeds `confidenceThreshold` (Requirement 8.2).
 * - Returns `{ status: "not_matched", confidence, livenessPassed, matchedAt }` when the
 *   confidence score falls below `confidenceThreshold` (Requirement 8.3). The caller
 *   is responsible for raising the security-control-room alert and incident record.
 * - `livenessPassed` is passed through unchanged from the external liveness-detection
 *   result (Requirement 8.4) — this adapter does not derive or override it.
 */
export async function matchFace(
  input: AadhaarFaceMatchInput,
  confidenceThreshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
): Promise<AadhaarFaceMatchResult> {
  if (!AADHAAR_FACE_MATCH_ENABLED) {
    return { status: "unavailable", fallbackToManual: true };
  }

  try {
    const response = await breaker.call(async () => {
      const res = await fetchWithTimeout(`${AADHAAR_FACE_MATCH_URL}/v2/face/match`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${AADHAAR_FACE_MATCH_CLIENT_ID}`,
        },
        body: JSON.stringify({
          livePhoto: input.livePhotoBase64,
          aadhaarRef: input.aadhaarRef,
        }),
      });

      if (!res.ok) {
        throw new Error(`Aadhaar face-match HTTP ${res.status}`);
      }

      return res.json() as Promise<FaceMatchApiResponse>;
    });

    const confidence = response.confidence ?? 0;
    const livenessPassed = response.livenessPassed ?? false;
    const matchedAt = new Date();

    if (confidence >= confidenceThreshold) {
      return { status: "matched", confidence, livenessPassed, matchedAt };
    }
    return { status: "not_matched", confidence, livenessPassed, matchedAt };
  } catch (err: unknown) {
    // Circuit open (either rejected immediately, or this call just tripped it) — fail-closed.
    if (err instanceof CircuitBreakerOpenError || breaker.state === "open") {
      return { status: "unavailable", fallbackToManual: true };
    }
    // Any other error (timeout, network failure, non-2xx) — fail-closed, never fabricate a match.
    return { status: "unavailable", fallbackToManual: true };
  }
}

/** Returns the current state of the circuit breaker. */
export function getBreakerState(): "closed" | "open" | "half-open" {
  return breaker.state;
}

/** Returns true if the adapter is enabled and configured. */
export function isEnabled(): boolean {
  return AADHAAR_FACE_MATCH_ENABLED;
}
