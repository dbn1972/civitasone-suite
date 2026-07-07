/**
 * ML Service adapter — SLA breach prediction.
 *
 * Calls the ml-service `POST /v1/ml/predict` endpoint with circuit-breaker
 * protection. Returns the raw prediction response or null on any failure
 * (never throws to the caller — graceful degradation).
 *
 * Env vars:
 *   ML_SERVICE_URL          — ml-service base URL (default: http://localhost:3032)
 *   FEATURE_ML_ENABLED      — "true" to activate; anything else → fallback mode
 *   ML_PREDICT_TIMEOUT_MS   — request timeout (default: 10000)
 *
 * No PII is logged — only entity IDs, domain, tenantId, and timing.
 */

import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";
import { pino } from "pino";

const logger = pino({ name: "ml-breach-adapter" });

// ── Types ─────────────────────────────────────────────────────────

export interface MlPredictionResponse {
  prediction: number | null;
  confidence: number;
  factors: Array<{ feature: string; contribution: number; direction: "positive" | "negative" }>;
  fallback: boolean;
  reason?: string;
  modelVersion?: number;
}

export interface MlPredictRequest {
  tenantId: string;
  domain: string;
  entityId: string;
  features: Record<string, number | string>;
}

// ── Config ────────────────────────────────────────────────────────

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:3032";
const ENABLED = process.env.FEATURE_ML_ENABLED === "true";
const TIMEOUT_MS = Number(process.env.ML_PREDICT_TIMEOUT_MS ?? "10000");

// ── Circuit Breaker ───────────────────────────────────────────────

const breaker = new CircuitBreaker({
  name: "ml-service-breach",
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
 * Call ml-service to predict SLA breach probability.
 *
 * Returns null when:
 * - FEATURE_ML_ENABLED is not "true"
 * - circuit breaker is open
 * - ml-service returns a non-200 response
 * - request times out
 *
 * Never throws — returns null for graceful degradation to fallback.
 */
export async function predictBreachRisk(
  request: MlPredictRequest,
): Promise<MlPredictionResponse | null> {
  if (!ENABLED) {
    return null;
  }

  try {
    return await breaker.call(async () => {
      const url = `${ML_SERVICE_URL}/v1/ml/predict`;
      const startMs = Date.now();

      let res: Response;
      try {
        res = await fetchWithTimeout(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          logger.warn({ entityId: request.entityId, domain: request.domain }, "ml-service request timed out");
        } else {
          logger.warn({ entityId: request.entityId, domain: request.domain }, "ml-service request failed");
        }
        throw err; // Let circuit breaker track the failure
      }

      const latencyMs = Date.now() - startMs;
      logger.info({ entityId: request.entityId, domain: request.domain, status: res.status, latencyMs }, "ml-service response");

      if (!res.ok) {
        throw new Error(`ml-service returned ${res.status}`);
      }

      return (await res.json()) as MlPredictionResponse;
    });
  } catch (err: unknown) {
    if (err instanceof CircuitBreakerOpenError) {
      logger.warn({ entityId: request.entityId }, "ml-service circuit breaker open");
    }
    return null;
  }
}

/** Returns true if the ML feature is enabled. */
export function isMlEnabled(): boolean {
  return ENABLED;
}

/** Returns the current state of the circuit breaker. */
export function getBreakerState(): "closed" | "open" | "half-open" {
  return breaker.state;
}

export { CircuitBreakerOpenError };
