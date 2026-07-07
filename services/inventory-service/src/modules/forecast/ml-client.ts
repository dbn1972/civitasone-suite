/**
 * ML Service HTTP client — calls the ml-service /v1/ml/predict endpoint.
 *
 * Wrapped with @civitasone/circuit-breaker (5 failures → 30s open).
 * On failure (CB open, timeout, error), returns null so the route can fall back to SMA.
 *
 * Requirements: 8.2, 3.4, 3.5
 */
import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";
import { pino } from "pino";

const log = pino({ name: "inventory-forecast-ml-client" });

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:3032";
const ML_TIMEOUT_MS = Number(process.env.ML_TIMEOUT_MS ?? "10000");

const breaker = new CircuitBreaker({
  name: "inventory-ml-predict",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

export interface MlPredictRequest {
  tenantId: string;
  domain: "inventory";
  entityId: string;
  features: Record<string, number>;
}

export interface MlPredictResponse {
  prediction: number | null;
  confidence: number;
  factors: Array<{ feature: string; contribution: number; direction: "positive" | "negative" }>;
  fallback: boolean;
  modelVersion?: number;
  dailyForecast?: number[];
}

/**
 * Call ml-service for a demand forecast prediction.
 * Returns null on any failure (CB open, timeout, HTTP error) — caller uses SMA fallback.
 */
export async function predictDemand(req: MlPredictRequest): Promise<MlPredictResponse | null> {
  try {
    return await breaker.call(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ML_TIMEOUT_MS);

      try {
        const res = await fetch(`${ML_SERVICE_URL}/v1/ml/predict`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!res.ok) {
          log.warn({ status: res.status, entityId: req.entityId }, "ml-service returned non-200");
          throw new Error(`ml-service responded with ${res.status}`);
        }

        return (await res.json()) as MlPredictResponse;
      } catch (err) {
        clearTimeout(timeout);
        throw err;
      }
    });
  } catch (err) {
    if (err instanceof CircuitBreakerOpenError) {
      log.warn({ entityId: req.entityId }, "ml-service circuit breaker is open — using fallback");
    } else {
      log.warn({ err, entityId: req.entityId }, "ml-service call failed — using fallback");
    }
    return null;
  }
}
