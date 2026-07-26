/**
 * Anthropic Claude adapter for citizen-service AI features.
 *
 * Env-gated: returns 404 when FEATURE_AI_ASSISTANT_ENABLED !== 'true'.
 * All outbound HTTP calls are wrapped with @civitasone/circuit-breaker
 * (5 consecutive failures → open for 30s, 10s timeout).
 *
 * Configuration resolution (per call): when a tenantId is supplied AND the
 * integration registry is wired (INTEGRATION_REGISTRY_DB_URL + CONFIG_ENC_KEY),
 * the Anthropic apiKey / model / baseUrl are resolved from the admin
 * integration_settings registry (provider `ai_anthropic`). Otherwise the
 * process env vars are used (backward compatible):
 *   FEATURE_AI_ASSISTANT_ENABLED — "true" to activate; anything else → 404
 *   ANTHROPIC_API_KEY            — API key for Anthropic Messages API
 *   ANTHROPIC_MODEL              — Model identifier (default: claude-sonnet-4-20250514)
 *   AI_TIMEOUT_MS                — Request timeout in ms (default: 10000)
 *
 * No PII is logged — only correlation IDs, status codes, and timing.
 */

import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";
import { resolveIntegration } from "@civitasone/integration-config";

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
const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_BASE_URL = "https://api.anthropic.com";
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? "10000");

type AiConfig = { apiKey: string; model: string; baseUrl: string };

/** Resolve Anthropic config from the registry (per-tenant) or env vars. */
async function resolveConfig(tenantId?: string): Promise<AiConfig> {
  if (tenantId) {
    const reg = await resolveIntegration({ provider: "ai_anthropic", tenantId });
    if (reg && reg.secrets.apiKey) {
      return {
        apiKey: reg.secrets.apiKey,
        model: String(reg.config.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL),
        baseUrl: String(reg.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, ""),
      };
    }
  }
  return {
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    model: process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
    baseUrl: DEFAULT_BASE_URL,
  };
}

// ── Circuit Breaker ───────────────────────────────────────────────

const breaker = new CircuitBreaker({
  name: "anthropic-citizen-ai",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

// ── Helpers ───────────────────────────────────────────────────────

function assertEnabled(): void {
  if (!ENABLED) {
    throw new AiAdapterError(
      "AI assistant is not available",
      "FEATURE_NOT_AVAILABLE",
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

/** Optional per-call options. `tenantId` enables registry-backed config. */
export type SendPromptOpts = { tenantId?: string };

/**
 * Send a prompt to Anthropic Claude Messages API.
 *
 * @param system - System prompt
 * @param userMessage - User message content
 * @param maxTokens - Max tokens in response (default 512)
 * @param opts - Optional { tenantId } to resolve config from the registry
 * @returns The assistant's text response
 *
 * Throws AiAdapterError with code "FEATURE_NOT_AVAILABLE" when not configured.
 * Throws CircuitBreakerOpenError when the circuit breaker is open.
 * Throws AiAdapterError with code "AI_API_ERROR" on upstream failures.
 * Throws AiAdapterError with code "AI_TIMEOUT" on request timeout.
 */
export async function sendPrompt(
  system: string,
  userMessage: string,
  maxTokens = 512,
  opts?: SendPromptOpts,
): Promise<string> {
  assertEnabled();

  const cfg = await resolveConfig(opts?.tenantId);

  return breaker.call(async () => {
    let res: Response;
    try {
      res = await fetchWithTimeout(`${cfg.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": cfg.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: cfg.model,
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

/** Returns true if the AI assistant feature is enabled. */
export function isEnabled(): boolean {
  return ENABLED;
}

export { CircuitBreakerOpenError };
