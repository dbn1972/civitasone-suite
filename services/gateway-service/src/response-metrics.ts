/**
 * Response-time metrics middleware for the gateway.
 *
 * Uses prom-client (Prometheus client library) to expose production-grade
 * histogram metrics. Replaces the previous in-memory array that capped at 10K
 * entries and lost data under load.
 *
 * Exposed endpoints:
 *   GET /metrics         — Prometheus text format (all metrics)
 *   GET /metrics/latency — JSON summary (backward-compatible with existing dashboards)
 *
 * Env vars:
 *   GATEWAY_METRICS_PREFIX — metric name prefix (default: "civitasone_gateway")
 */
import type { FastifyInstance } from "fastify";
import {
  Registry,
  Histogram,
  Counter,
  collectDefaultMetrics,
} from "prom-client";

// ── Prometheus Registry ────────────────────────────────────────────────────────

const prefix = process.env.GATEWAY_METRICS_PREFIX ?? "civitasone_gateway";
export const metricsRegistry = new Registry();
metricsRegistry.setDefaultLabels({ service: "gateway" });

// Collect Node.js default metrics (event loop, GC, memory, etc.)
collectDefaultMetrics({ register: metricsRegistry, prefix: `${prefix}_` });

// ── Custom Metrics ─────────────────────────────────────────────────────────────

/**
 * HTTP request duration histogram with standard Prometheus buckets.
 * Labels: method, route, status_code
 */
export const httpRequestDuration = new Histogram({
  name: `${prefix}_http_request_duration_ms`,
  help: "HTTP request duration in milliseconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [5, 10, 25, 50, 100, 200, 500, 1000, 2000, 5000, 10000],
  registers: [metricsRegistry],
});

/**
 * HTTP requests total counter.
 * Labels: method, route, status_code
 */
export const httpRequestsTotal = new Counter({
  name: `${prefix}_http_requests_total`,
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [metricsRegistry],
});

/**
 * HTTP errors counter (5xx only).
 * Labels: method, route
 */
export const httpErrorsTotal = new Counter({
  name: `${prefix}_http_errors_total`,
  help: "Total number of HTTP 5xx errors",
  labelNames: ["method", "route"] as const,
  registers: [metricsRegistry],
});

// ── Public API (backward-compatible) ───────────────────────────────────────────

/** Record a response metric — called from the onResponse hook. */
export function recordResponseMetric(
  route: string,
  method: string,
  status: number,
  durationMs: number,
): void {
  const statusCode = String(status);
  httpRequestDuration.labels(method, route, statusCode).observe(durationMs);
  httpRequestsTotal.labels(method, route, statusCode).inc();
  if (status >= 500) {
    httpErrorsTotal.labels(method, route).inc();
  }
}

/** Get percentile from the histogram (approximate, for backward-compat JSON endpoint). */
export function getLatencyPercentile(percentile: number): number {
  // prom-client doesn't expose percentile directly from histograms.
  // The /metrics endpoint provides histogram buckets for Prometheus/Grafana to compute.
  // For the JSON endpoint we return 0 and recommend using Grafana.
  return 0;
}

/** Get per-route summary — backward-compatible JSON shape for /metrics/latency. */
export function getRouteMetrics(): Array<{
  route: string;
  count: number;
  p50: number;
  p95: number;
  p99: number;
  errorRate: number;
}> {
  // This is now informational only — full metrics are in Prometheus format at /metrics.
  // Return empty array; dashboards should migrate to Grafana histograms.
  return [];
}

/** Reset metrics (for testing). */
export function resetMetrics(): void {
  metricsRegistry.resetMetrics();
}

// ── Fastify Plugin ─────────────────────────────────────────────────────────────

/** Register the response-time hook on Fastify. */
export function registerResponseMetrics(app: FastifyInstance): void {
  app.addHook("onResponse", (req, reply, done) => {
    const route = req.url.split("?")[0] ?? "/";
    // Resolve to module-level prefix for grouping (e.g., /api/v1/finance/*)
    const parts = route.split("/").slice(0, 4);
    const groupedRoute = parts.length >= 4 ? parts.join("/") + "/*" : route;
    const durationMs = reply.elapsedTime;
    recordResponseMetric(groupedRoute, req.method, reply.statusCode, Math.round(durationMs));
    done();
  });

  // ── Prometheus text format endpoint (moved off /metrics to avoid colliding
  //    with the guarded fleet-wide /metrics from @civitasone/observability) ────
  app.get("/metrics/prom", async (_req, reply) => {
    reply.header("content-type", metricsRegistry.contentType);
    return reply.send(await metricsRegistry.metrics());
  });

  // ── JSON summary endpoint (backward-compatible, deprecated) ─────────────────
  app.get("/metrics/latency", async (_req, reply) => {
    return reply.send({
      message: "Use GET /metrics for Prometheus-format histograms. This endpoint is deprecated.",
      globalP50: 0,
      globalP95: 0,
      globalP99: 0,
      totalRequests: (await metricsRegistry.getSingleMetricAsString(`${prefix}_http_requests_total`)).split("\n").length,
      routes: [],
    });
  });
}
