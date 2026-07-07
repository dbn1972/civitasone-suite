/**
 * ML Service adapter for churn prediction.
 *
 * Calls ml-service POST /v1/ml/predict with domain "subscriptions".
 * Wrapped with @civitasone/circuit-breaker (5 failures in 60s → open for 30s).
 *
 * Env vars:
 *   ML_SERVICE_URL       — Base URL for ml-service (default: http://localhost:3032)
 *   FEATURE_ML_ENABLED   — "true" to activate; anything else → fallback mode
 *
 * No PII is logged — only correlation IDs, status codes, and timing.
 */

import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";

// ── Types ─────────────────────────────────────────────────────────

export interface MlPredictionRequest {
  tenantId: string;
  domain: "subscriptions";
  entityId: string;
  features: Record<string, number | string> | undefined;
}

export interface ExplainabilityFactor {
  feature: string;
  contribution: number;
  direction: "positive" | "negative";
}

export interface MlPredictionResponse {
  prediction: number | null;
  confidence: number;
  factors: ExplainabilityFactor[];
  fallback: boolean;
  reason?: string;
  modelVersion?: number;
  advisory: true;
  lowConfidence?: boolean;
}

// ── Errors ────────────────────────────────────────────────────────

export class MlAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "MlAdapterError";
  }
}

// ── Config ────────────────────────────────────────────────────────

const ML_URL = process.env.ML_SERVICE_URL ?? "http://localhost:3032";
const ENABLED = process.env.FEATURE_ML_ENABLED === "true";
const TIMEOUT_MS = Number(process.env.ML_TIMEOUT_MS ?? "10000");

// ── Circuit Breaker ───────────────────────────────────────────────

const breaker = new CircuitBreaker({
  name: "ml-churn",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

// ── Helpers ───────────────────────────────────────────────────────

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
 * Call ml-service to get a churn prediction for a subscription.
 *
 * Returns null when ML is disabled (callers should use fallback logic).
 * Throws MlAdapterError on non-2xx responses.
 * Throws CircuitBreakerOpenError when the breaker is open.
 */
export async function predictChurn(
  tenantId: string,
  entityId: string,
  features?: Record<string, number | string>,
): Promise<MlPredictionResponse | null> {
  if (!ENABLED) return null;

  return breaker.call(async () => {
    const res = await fetchWithTimeout(`${ML_URL}/v1/ml/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        domain: "subscriptions",
        entityId,
        features,
      } satisfies MlPredictionRequest),
    });

    if (!res.ok) {
      throw new MlAdapterError(
        `ml-service returned ${res.status}`,
        "ML_API_ERROR",
        res.status,
      );
    }

    return (await res.json()) as MlPredictionResponse;
  });
}

/** Returns the current state of the circuit breaker. */
export function getBreakerState(): "closed" | "open" | "half-open" {
  return breaker.state;
}

/** Returns true if ML feature is enabled. */
export function isEnabled(): boolean {
  return ENABLED;
}

export { CircuitBreakerOpenError };
