/**
 * Upstream proxy with per-service circuit breaker and configurable timeouts.
 *
 * Each upstream service gets its own circuit breaker instance. When a service
 * becomes unresponsive (timeouts or 5xx errors N times consecutively), the
 * breaker trips open and the gateway returns 503 immediately — preventing one
 * slow service from blocking all gateway workers.
 *
 * Env vars:
 *   GATEWAY_UPSTREAM_TIMEOUT_MS — per-request timeout (default: 15000)
 *   GATEWAY_CB_FAILURE_THRESHOLD — consecutive failures to trip open (default: 5)
 *   GATEWAY_CB_RECOVERY_MS — open→half-open transition time (default: 15000)
 */
import { CircuitBreaker, CircuitBreakerOpenError } from "@civitasone/circuit-breaker";
import { pino } from "pino";
import { configValue } from "./runtime-config.js";

const log = pino({ name: "gateway-upstream" });

// Per-service breaker map (lazy-created on first request to each upstream).
const breakers = new Map<string, CircuitBreaker>();

function getBreaker(serviceName: string): CircuitBreaker {
  let breaker = breakers.get(serviceName);
  if (!breaker) {
    breaker = new CircuitBreaker({
      name: `upstream:${serviceName}`,
      failureThreshold: configValue("cbFailureThreshold"),
      recoveryMs: configValue("cbRecoveryMs"),
    });
    breakers.set(serviceName, breaker);
  }
  return breaker;
}

export interface UpstreamResponse {
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}

export interface ProxyRequestInit {
  method: string;
  headers: Record<string, string>;
  body?: string | null;
  /** Logical upstream service name (used to key the circuit breaker) */
  serviceName: string;
  /** Full target URL */
  url: string;
}

/**
 * Execute a proxied request through the circuit breaker with timeout.
 *
 * Returns a discriminated result:
 *  - `{ ok: true, response }` on success (even for 4xx — those are the upstream's business)
 *  - `{ ok: false, status, code, message }` on gateway-level failure (timeout, breaker open, network error)
 */
export async function proxyFetch(
  init: ProxyRequestInit,
): Promise<
  | { ok: true; response: Response }
  | { ok: false; status: number; code: string; message: string }
> {
  const breaker = getBreaker(init.serviceName);

  try {
    const response = await breaker.call(async () => {
      const timeoutMs = configValue("upstreamTimeoutMs");
      // AbortSignal.timeout() governs the response BODY too, not just headers —
      // it would sever a long-lived SSE stream at timeoutMs. SSE connections are
      // heartbeat-kept-alive and idle-timed-out by the upstream itself.
      const isEventStream = (init.headers["accept"] ?? "").includes("text/event-stream");
      const fetchInit: RequestInit = {
        method: init.method,
        headers: init.headers,
        ...(isEventStream ? {} : { signal: AbortSignal.timeout(timeoutMs) }),
      };
      if (init.body) fetchInit.body = init.body;

      const res = await fetch(init.url, fetchInit);

      // Treat 5xx from upstream as a "failure" for the circuit breaker.
      // 4xx is the client's fault, not the upstream's — don't penalise.
      if (res.status >= 500) {
        throw new UpstreamServerError(init.serviceName, res.status);
      }
      return res;
    });

    return { ok: true, response };
  } catch (err) {
    if (err instanceof CircuitBreakerOpenError) {
      log.warn({ service: init.serviceName }, "circuit breaker open — request rejected");
      return {
        ok: false,
        status: 503,
        code: "SERVICE_UNAVAILABLE",
        message: `Upstream service "${init.serviceName}" is temporarily unavailable (circuit breaker open)`,
      };
    }

    if (err instanceof UpstreamServerError) {
      // The breaker already recorded this as a failure. Return the upstream's
      // status so the client sees the real 5xx code.
      log.warn({ service: init.serviceName, status: err.upstreamStatus }, "upstream 5xx");
      return {
        ok: false,
        status: err.upstreamStatus,
        code: "UPSTREAM_ERROR",
        message: `Upstream service "${init.serviceName}" returned ${err.upstreamStatus}`,
      };
    }

    // AbortSignal.timeout throws a DOMException with name "TimeoutError"
    if (err instanceof Error && err.name === "TimeoutError") {
      const timeoutMs = configValue("upstreamTimeoutMs");
      log.warn({ service: init.serviceName, timeoutMs }, "upstream timeout");
      return {
        ok: false,
        status: 504,
        code: "GATEWAY_TIMEOUT",
        message: `Upstream service "${init.serviceName}" did not respond within ${timeoutMs}ms`,
      };
    }

    // Network error (ECONNREFUSED, DNS failure, etc.)
    log.error({ service: init.serviceName, err }, "upstream network error");
    return {
      ok: false,
      status: 502,
      code: "BAD_GATEWAY",
      message: `Cannot reach upstream service "${init.serviceName}"`,
    };
  }
}

/** Sentinel error used to signal 5xx from upstream into the breaker's failure path. */
class UpstreamServerError extends Error {
  constructor(
    public readonly serviceName: string,
    public readonly upstreamStatus: number,
  ) {
    super(`Upstream ${serviceName} returned ${upstreamStatus}`);
    this.name = "UpstreamServerError";
  }
}

/** Expose breaker state for ops/metrics. */
export function getBreakerStates(): Array<{ service: string; state: string }> {
  return [...breakers.entries()].map(([service, b]) => ({ service, state: b.state }));
}

/** Reset all breakers (testing only). */
export function _resetBreakers(): void {
  breakers.clear();
}
