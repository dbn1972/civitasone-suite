/**
 * G20 — Serviceability adapter port (integration client).
 *
 * Calls apt-adapter via HTTP, protected by a circuit breaker and backed by
 * Redis caching. Degrades gracefully on failure: returns cached value with
 * `degraded: true`, or `{ serviceable: null, degraded: true }` when no cache.
 */
import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";
import { cache } from "../../shared/infra.js";
import {
  serviceabilityCacheKey,
  fromAdapterResponse,
  degradedFromCache,
  degradedUnknown,
  type AdapterServiceabilityResponse,
  type ServiceabilityResult,
} from "./domain.js";

/** Circuit breaker: 5 consecutive failures → open for 30s. */
const breaker = new CircuitBreaker({
  name: "apt-adapter-serviceability",
  failureThreshold: 5,
  recoveryMs: 30_000,
});

const ADAPTER_BASE_URL = process.env.APT_ADAPTER_URL ?? "http://localhost:3050";
const TIMEOUT_MS = Number(process.env.SERVICEABILITY_TIMEOUT_MS ?? 5000);
const CACHE_TTL_SECONDS = 300; // 5 minutes

/**
 * Check serviceability by calling the apt-adapter, with circuit-breaking and caching.
 *
 * Happy path: call adapter → cache result → return.
 * Failure path (timeout, 5xx, circuit-open): return cached value (degraded) or unknown.
 */
export async function checkServiceability(
  tenantId: string,
  originPin: string,
  destinationPin: string,
  articleType: string,
): Promise<ServiceabilityResult> {
  const cacheKey = serviceabilityCacheKey(tenantId, originPin, destinationPin, articleType);

  try {
    const result = await breaker.call(async () => {
      const url = new URL("/v1/adapters/apt/serviceability", ADAPTER_BASE_URL);
      url.searchParams.set("originPin", originPin);
      url.searchParams.set("destinationPin", destinationPin);
      url.searchParams.set("articleType", articleType);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const resp = await fetch(url.toString(), {
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
        });

        if (!resp.ok) {
          throw new Error(`apt-adapter returned ${resp.status}`);
        }

        const body = (await resp.json()) as AdapterServiceabilityResponse;
        return body;
      } finally {
        clearTimeout(timer);
      }
    });

    const mapped = fromAdapterResponse(result);

    // Cache the successful response
    await cache.put(cacheKey, mapped, CACHE_TTL_SECONDS);

    return mapped;
  } catch (err) {
    // Degrade gracefully: try to serve from cache
    return handleDegradation(cacheKey, err);
  }
}

async function handleDegradation(
  cacheKey: string,
  _err: unknown,
): Promise<ServiceabilityResult> {
  const cached = await cache.getOrLoad<ServiceabilityResult>(cacheKey, async () => null);
  if (cached) {
    return degradedFromCache(cached);
  }
  return degradedUnknown();
}

/** Exposed for testing — get the breaker instance so tests can inspect its state. */
export { breaker as _breaker };
