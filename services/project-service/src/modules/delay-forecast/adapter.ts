/**
 * ML Service adapter for project delay prediction.
 *
 * Calls ml-service POST /v1/ml/internal/delay-forecast/simulate — the REAL
 * Monte Carlo simulation (ml-service's src/modules/algorithms/monte-carlo.ts),
 * over this project's actual task graph. Authenticated via the internal
 * service-to-service mechanism (x-internal + x-service-secret + x-tenant-id;
 * see packages/auth/src/plugin.ts), the same one
 * services/payroll-service/src/shared/hrms-client.ts already uses to call
 * hrms-service.
 * Wrapped with @civitasone/circuit-breaker (5 failures in 60s → open for 30s).
 *
 * DOM-017: this adapter used to call the unrelated generic
 * POST /v1/ml/predict (logistic regression over the "tasks" domain) with just
 * two scalar counts, and without ANY of the headers above — a request that
 * could never succeed (no "tasks" model is ever registered there, and it was
 * missing internal-service auth entirely) — so every call fell through to
 * routes.ts's/consumer.ts's local fallback computation, silently, on every
 * single request. This now calls the real endpoint with the real task list.
 *
 * Env vars:
 *   ML_SERVICE_URL          — Base URL for ml-service (default: http://localhost:3032)
 *   FEATURE_ML_ENABLED      — "true" to activate; anything else → fallback mode
 *   INTERNAL_SERVICE_SECRET — shared secret for the x-internal service auth path
 *
 * No PII is logged — only correlation IDs, status codes, and timing.
 */

import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";
import type { TaskData } from "./domain.js";

// ── Types ─────────────────────────────────────────────────────────

/** The subset of TaskData that ml-service's Monte Carlo module actually needs. */
export interface MlSimTaskInput {
  taskId: string;
  baselineDurationMs: number;
  varianceMs: number;
  dependencies: string[];
  assignedTo?: string;
  isCriticalPath: boolean;
}

export interface MlDelaySimulateRequest {
  projectId: string;
  tasks: MlSimTaskInput[];
  iterations?: number;
  seed?: number;
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

/** exactOptionalPropertyTypes: only set assignedTo when the source task has one. */
function toSimTask(t: TaskData): MlSimTaskInput {
  return {
    taskId: t.taskId,
    baselineDurationMs: t.baselineDurationMs,
    varianceMs: t.varianceMs,
    dependencies: t.dependencies,
    ...(t.assignedTo !== undefined ? { assignedTo: t.assignedTo } : {}),
    isCriticalPath: t.isCriticalPath,
  };
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Call ml-service to run the REAL Monte Carlo simulation for a project's
 * actual task graph.
 *
 * Returns null when ML is disabled or there are no tasks to simulate
 * (callers should use fallback logic in both cases).
 * Throws MlAdapterError on non-2xx responses (network failures throw the
 * underlying fetch error — both are caught by breaker.call() and count
 * toward the circuit breaker's failure threshold).
 * Throws CircuitBreakerOpenError when the breaker is open.
 */
export async function predictDelay(
  tenantId: string,
  projectId: string,
  tasks: TaskData[],
  options?: { iterations?: number; seed?: number },
): Promise<MlDelayForecastResponse | null> {
  if (!ENABLED) return null;
  if (tasks.length === 0) return null;

  return breaker.call(async () => {
    const res = await fetchWithTimeout(`${ML_URL}/v1/ml/internal/delay-forecast/simulate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal": "1",
        "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
        "x-tenant-id": tenantId,
      },
      body: JSON.stringify({
        projectId,
        tasks: tasks.map(toSimTask),
        ...(options?.iterations !== undefined ? { iterations: options.iterations } : {}),
        ...(options?.seed !== undefined ? { seed: options.seed } : {}),
      } satisfies MlDelaySimulateRequest),
    });

    if (!res.ok) {
      throw new MlAdapterError(
        `ml-service delay-forecast simulate returned ${res.status}`,
        "ML_API_ERROR",
        res.status,
      );
    }

    const body = (await res.json()) as { data: MlDelayForecastResponse };
    return body.data;
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
