/**
 * ML Service adapter for project delay prediction.
 *
 * Calls ml-service POST /v1/ml/predict with domain "tasks".
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

export interface MlDelayPredictionRequest {
  tenantId: string;
  domain: "tasks";
  entityId: string;
  features: Record<string, number | string> | undefined;
}

export interface ExplainabilityFactor {
  feature: string;
  contribution: number;
  direction: "positive" | "negative";
}

export interface TaskRiskResult {
  taskId: string;
  riskScore: number;
  factors: string[];
}

export interface ResourceBottleneckResult {
  userId: string;
  concurrentCriticalTasks: number;
}

export interface MlDelayForecastResponse {
  p50Ms: number;
  p80Ms: number;
  p95Ms: number;
  taskRisks: TaskRiskResult[];
  bottlenecks: ResourceBottleneckResult[];
  fallback: boolean;
  reason?: string;
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
  name: "ml-delay-forecast",
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
 * Call ml-service to run Monte Carlo simulation for a project.
 *
 * Returns null when ML is disabled (callers should use fallback logic).
 * Throws MlAdapterError on non-2xx responses.
 * Throws CircuitBreakerOpenError when the breaker is open.
 */
export async function predictDelay(
  tenantId: string,
  projectId: string,
  features?: Record<string, number | string>,
): Promise<MlDelayForecastResponse | null> {
  if (!ENABLED) return null;

  return breaker.call(async () => {
    const res = await fetchWithTimeout(`${ML_URL}/v1/ml/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        domain: "tasks",
        entityId: projectId,
        features,
      } satisfies MlDelayPredictionRequest),
    });

    if (!res.ok) {
      throw new MlAdapterError(
        `ml-service returned ${res.status}`,
        "ML_API_ERROR",
        res.status,
      );
    }

    return (await res.json()) as MlDelayForecastResponse;
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
