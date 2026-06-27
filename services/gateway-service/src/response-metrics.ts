/**
 * Response-time metrics middleware for the gateway.
 * Records per-route latency histograms for Prometheus scraping.
 */
import type { FastifyInstance } from "fastify";

type LatencyBucket = { route: string; method: string; status: number; durationMs: number };

const latencyLog: LatencyBucket[] = [];
const MAX_LOG_SIZE = 10_000;

/** Record a response metric */
export function recordResponseMetric(route: string, method: string, status: number, durationMs: number): void {
  if (latencyLog.length >= MAX_LOG_SIZE) latencyLog.shift();
  latencyLog.push({ route, method, status, durationMs });
}

/** Get percentile from the collected metrics (for /metrics endpoint) */
export function getLatencyPercentile(percentile: number): number {
  if (latencyLog.length === 0) return 0;
  const sorted = [...latencyLog].sort((a, b) => a.durationMs - b.durationMs);
  const idx = Math.min(Math.floor(sorted.length * (percentile / 100)), sorted.length - 1);
  return sorted[idx]?.durationMs ?? 0;
}

/** Get per-route summary */
export function getRouteMetrics(): Array<{ route: string; count: number; p50: number; p95: number; p99: number; errorRate: number }> {
  const groups = new Map<string, LatencyBucket[]>();
  for (const entry of latencyLog) {
    const existing = groups.get(entry.route) ?? [];
    existing.push(entry);
    groups.set(entry.route, existing);
  }

  const results: Array<{ route: string; count: number; p50: number; p95: number; p99: number; errorRate: number }> = [];
  for (const [route, entries] of groups) {
    const sorted = entries.sort((a, b) => a.durationMs - b.durationMs);
    const count = sorted.length;
    const errors = sorted.filter((e) => e.status >= 500).length;
    results.push({
      route,
      count,
      p50: sorted[Math.floor(count * 0.5)]?.durationMs ?? 0,
      p95: sorted[Math.floor(count * 0.95)]?.durationMs ?? 0,
      p99: sorted[Math.floor(count * 0.99)]?.durationMs ?? 0,
      errorRate: count > 0 ? Math.round((errors / count) * 100) : 0,
    });
  }
  return results.sort((a, b) => b.p95 - a.p95);
}

/** Reset metrics (for testing) */
export function resetMetrics(): void {
  latencyLog.length = 0;
}

/** Register the response-time hook on Fastify */
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

  // Expose metrics summary endpoint
  app.get("/metrics/latency", async (_req, reply) => {
    return reply.send({
      globalP50: getLatencyPercentile(50),
      globalP95: getLatencyPercentile(95),
      globalP99: getLatencyPercentile(99),
      totalRequests: latencyLog.length,
      routes: getRouteMetrics(),
    });
  });
}
