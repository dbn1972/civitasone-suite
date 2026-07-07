/**
 * Anthropic Claude adapter — AI Assistant integration.
 *
 * Env-gated: all features return 404 when FEATURE_AI_ASSISTANT_ENABLED !== 'true'.
 * All outbound HTTP calls are wrapped with @civitasone/circuit-breaker
 * (5 consecutive failures → open for 30s).
 *
 * Env vars:
 *   FEATURE_AI_ASSISTANT_ENABLED — "true" to activate; anything else → 404
 *   ANTHROPIC_API_KEY            — API key for Anthropic Messages API
 *   ANTHROPIC_MODEL              — Model identifier (default: claude-sonnet-4-20250514)
 *
 * No PII is logged — only correlation IDs, status codes, and timing.
 */

import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";

// ── Types ─────────────────────────────────────────────────────────

export interface SendPromptOptions {
  maxTokens?: number;
}

// ── Errors ────────────────────────────────────────────────────────

export class AiAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "AiAdapterError";
  }
}

// ── Config ────────────────────────────────────────────────────────

const ENABLED = process.env.FEATURE_AI_ASSISTANT_ENABLED === "true";
const API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? "10000");

// ── Circuit Breaker ───────────────────────────────────────────────

const breaker = new CircuitBreaker({
  name: "anthropic-claude",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

// ── Helpers ───────────────────────────────────────────────────────

function assertEnabled(): void {
  if (!ENABLED) {
    throw new AiAdapterError(
      "AI assistant is not available",
      "AI_DISABLED",
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

/**
 * Send a prompt to Anthropic Claude Messages API.
 *
 * @param system - System prompt
 * @param userMessage - User message content
 * @param options - Optional configuration (maxTokens)
 * @returns The assistant's text response
 *
 * Throws AiAdapterError with code "AI_DISABLED" when not configured.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 * Throws AiAdapterError with code "AI_API_ERROR" on upstream failures.
 * Throws AiAdapterError with code "AI_TIMEOUT" on request timeout.
 */
export async function sendPrompt(
  system: string,
  userMessage: string,
  options?: SendPromptOptions,
): Promise<string> {
  assertEnabled();

  return breaker.call(async () => {
    const maxTokens = options?.maxTokens ?? 1024;

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
        throw new AiAdapterError(
          "Anthropic API request timed out",
          "AI_TIMEOUT",
        );
      }
      throw new AiAdapterError(
        "Anthropic API request failed",
        "AI_API_ERROR",
      );
    }

    if (!res.ok) {
      throw new AiAdapterError(
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

/** Returns true if the AI assistant is enabled. */
export function isEnabled(): boolean {
  return ENABLED;
}

export { CircuitBreakerOpenError };
