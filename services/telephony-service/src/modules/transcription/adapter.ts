/**
 * Transcription adapter — env-gated external transcription API integration.
 *
 * Env-gated: fails closed when TRANSCRIPTION_ENABLED !== 'true'.
 * All outbound calls wrapped with @civitasone/circuit-breaker
 * (5 consecutive failures → open for 30s).
 *
 * Env vars:
 *   TRANSCRIPTION_ENABLED   — "true" to activate; anything else → fail-closed
 *   TRANSCRIPTION_PROVIDER  — Provider name (e.g., "deepgram", "assemblyai", "whisper")
 *   TRANSCRIPTION_API_KEY   — API key for the transcription provider
 *   TRANSCRIPTION_BASE_URL  — Base URL for the transcription API
 *   TRANSCRIPTION_TIMEOUT_MS — Timeout in ms (default: 120000 = 120s)
 *
 * No PII is logged — only entity IDs and status codes.
 */

import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";

// ── Constants ─────────────────────────────────────────────────────

/** Maximum transcript length (500K characters). */
export const MAX_TRANSCRIPT_LENGTH = 500_000;

/** Default transcription timeout (120s). */
export const DEFAULT_TIMEOUT_MS = 120_000;

// ── Types ─────────────────────────────────────────────────────────

export interface TranscriptionResult {
  text: string;
  durationMs: number;
  provider: string;
}

// ── Errors ────────────────────────────────────────────────────────

export class TranscriptionAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "TranscriptionAdapterError";
  }
}

// ── Circuit Breaker ───────────────────────────────────────────────

const breaker = new CircuitBreaker({
  name: "transcription",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

// ── Helpers ───────────────────────────────────────────────────────

function getConfig() {
  return {
    enabled: process.env.TRANSCRIPTION_ENABLED === "true",
    provider: process.env.TRANSCRIPTION_PROVIDER ?? "",
    apiKey: process.env.TRANSCRIPTION_API_KEY ?? "",
    baseUrl: process.env.TRANSCRIPTION_BASE_URL ?? "",
    timeoutMs: Number(process.env.TRANSCRIPTION_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS)),
  };
}

function assertEnabled(): void {
  if (!isEnabled()) {
    throw new TranscriptionAdapterError(
      "Transcription integration is not available",
      "TRANSCRIPTION_DISABLED",
    );
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Invoke the transcription API for a stored recording.
 *
 * @param storageKey - The S3/MinIO key of the audio file to transcribe
 * @param presignedUrl - A presigned URL for the audio file (passed to the provider)
 * @returns Transcription result with text capped at MAX_TRANSCRIPT_LENGTH
 *
 * Throws TranscriptionAdapterError with code "TRANSCRIPTION_DISABLED" when not configured.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 * Throws TranscriptionAdapterError with code "TRANSCRIPTION_TIMEOUT" on timeout.
 * Throws TranscriptionAdapterError with code "TRANSCRIPTION_API_ERROR" on API errors.
 */
export async function transcribe(storageKey: string, presignedUrl: string): Promise<TranscriptionResult> {
  assertEnabled();

  const config = getConfig();
  const startTime = Date.now();

  return breaker.call(async () => {
    let res: Response;
    try {
      res = await fetchWithTimeout(`${config.baseUrl}/v1/transcribe`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          audioUrl: presignedUrl,
          provider: config.provider,
          storageKey,
        }),
      }, config.timeoutMs);
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new TranscriptionAdapterError(
          "Transcription timed out",
          "TRANSCRIPTION_TIMEOUT",
        );
      }
      throw new TranscriptionAdapterError(
        `Transcription request failed: ${(err as Error).message}`,
        "TRANSCRIPTION_API_ERROR",
      );
    }

    if (!res.ok) {
      throw new TranscriptionAdapterError(
        `Transcription API returned ${res.status}`,
        "TRANSCRIPTION_API_ERROR",
        res.status,
      );
    }

    const data = await res.json() as { text?: string; durationMs?: number };
    const rawText = data.text ?? "";
    // Enforce max 500K character limit at application layer.
    const text = rawText.length > MAX_TRANSCRIPT_LENGTH
      ? rawText.slice(0, MAX_TRANSCRIPT_LENGTH)
      : rawText;

    const durationMs = data.durationMs ?? (Date.now() - startTime);

    return {
      text,
      durationMs,
      provider: config.provider,
    };
  });
}

/** Returns the current state of the circuit breaker. */
export function getBreakerState(): "closed" | "open" | "half-open" {
  return breaker.state;
}

/** Returns true if the transcription adapter is enabled. Reads env at call time. */
export function isEnabled(): boolean {
  return process.env.TRANSCRIPTION_ENABLED === "true";
}

export { CircuitBreakerOpenError };
