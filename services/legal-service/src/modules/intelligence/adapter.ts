/**
 * Anthropic Claude adapter — Document Intelligence LLM integration.
 *
 * Env-gated: returns ML_UNAVAILABLE when FEATURE_ML_ENABLED !== 'true'.
 * All outbound HTTP calls are wrapped with @civitasone/circuit-breaker
 * (5 consecutive failures in 60s → open for 30s).
 *
 * Env vars:
 *   FEATURE_ML_ENABLED  — "true" to activate; anything else → 503
 *   ANTHROPIC_API_KEY   — API key for Anthropic Messages API
 *   ANTHROPIC_MODEL     — Model identifier (default: claude-sonnet-4-20250514)
 *   AI_TIMEOUT_MS       — Request timeout in milliseconds (default: 30000)
 *
 * No PII is logged — only entity IDs, status codes, and timing.
 */

import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";

// ── Errors ────────────────────────────────────────────────────────

export class LlmAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "LlmAdapterError";
  }
}

// ── Config ────────────────────────────────────────────────────────

const ENABLED = process.env.FEATURE_ML_ENABLED === "true";
const API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? "30000");

// ── Circuit Breaker ───────────────────────────────────────────────

const breaker = new CircuitBreaker({
  name: "legal-intelligence-anthropic",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

// ── Helpers ───────────────────────────────────────────────────────

function assertEnabled(): void {
  if (!ENABLED) {
    throw new LlmAdapterError(
      "ML intelligence is not available",
      "ML_DISABLED",
    );
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API ────────────────────────────────────────────────────

export interface SendPromptOptions {
  maxTokens?: number;
}

/**
 * Send a prompt to Anthropic Claude Messages API.
 *
 * Throws LlmAdapterError with code "ML_DISABLED" when feature flag is off.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 * Throws LlmAdapterError with code "AI_API_ERROR" on upstream failures.
 * Throws LlmAdapterError with code "AI_TIMEOUT" on request timeout.
 */
export async function sendPrompt(
  system: string,
  userMessage: string,
  options?: SendPromptOptions,
): Promise<string> {
  assertEnabled();

  return breaker.call(async () => {
    const maxTokens = options?.maxTokens ?? 4096;

    let res: Response;
    try {
      res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: userMessage }],
        }),
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new LlmAdapterError(
          "Anthropic API request timed out",
          "AI_TIMEOUT",
        );
      }
      throw new LlmAdapterError(
        "Anthropic API request failed",
        "AI_API_ERROR",
      );
    }

    if (!res.ok) {
      throw new LlmAdapterError(
        `Anthropic API returned ${res.status}`,
        "AI_API_ERROR",
        res.status,
      );
    }

    const data = await res.json() as {
      content?: Array<{ type: string; text?: string }>;
    };

    const textBlock = data.content?.find((block) => block.type === "text");
    return textBlock?.text ?? "";
  });
}

/** Returns the current state of the circuit breaker. */
export function getBreakerState(): "closed" | "open" | "half-open" {
  return breaker.state;
}

/** Returns true if the ML intelligence feature is enabled. */
export function isEnabled(): boolean {
  return ENABLED;
}

export { CircuitBreakerOpenError };
