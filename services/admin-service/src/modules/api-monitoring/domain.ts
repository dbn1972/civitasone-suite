/**
 * Pure rules for the in-house API metrics rollup (GAP-ADMIN-API-MONITORING-06).
 * The gateway keeps a latency histogram per (tenant, service, endpoint, minute)
 * so batches from several gateway pods merge by addition; p50 / p95 are read
 * from the merged histogram.
 */

/** Upper bounds (ms) of the latency buckets; one extra overflow bucket follows. MUST match the gateway collector. */
export const LATENCY_BOUNDS_MS = [5, 10, 25, 50, 100, 200, 500, 1000, 2000, 5000, 10000] as const;
export const LATENCY_BUCKET_COUNT = LATENCY_BOUNDS_MS.length + 1;

export const DEFAULT_RETENTION_DAYS = 30;
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 365;

/** Default read window for the monitoring table, and its ceiling. */
export const DEFAULT_WINDOW_MINUTES = 15;
export const MAX_WINDOW_MINUTES = 1440;

/**
 * Status thresholds on the 5xx rate (percent). VERIFY with the SRE owner.
 * 5xx only: a 4xx is the caller's mistake, not an unhealthy service.
 */
export const DEGRADED_5XX_PCT = 5;
export const DOWN_5XX_PCT = 50;

/** Percentile (0 < q <= 1) from bucket counts, interpolated inside the bucket. Null with no samples. */
export function percentileFromBuckets(buckets: readonly number[], q: number): number | null {
  const total = buckets.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const target = q * total;
  let seen = 0;
  for (let i = 0; i < buckets.length; i++) {
    const n = buckets[i] ?? 0;
    if (n <= 0) continue;
    if (seen + n >= target) {
      const lo = i === 0 ? 0 : (LATENCY_BOUNDS_MS[i - 1] ?? 0);
      // The overflow bucket has no upper bound: report its lower bound (the slowest value we can vouch for).
      const hi = LATENCY_BOUNDS_MS[i];
      if (hi === undefined) return lo;
      return Math.round(lo + ((target - seen) / n) * (hi - lo));
    }
    seen += n;
  }
  return LATENCY_BOUNDS_MS[LATENCY_BOUNDS_MS.length - 1] ?? null;
}

export function addBuckets(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  const len = Math.max(a.length, b.length, LATENCY_BUCKET_COUNT);
  for (let i = 0; i < len; i++) out.push((a[i] ?? 0) + (b[i] ?? 0));
  return out;
}

/** Percent (0-100, 2 dp) of requests that were 5xx; 0 when there were no requests. */
export function errorRatePct(errors5xx: number, requests: number): number {
  if (requests <= 0) return 0;
  return Math.round((errors5xx / requests) * 10000) / 100;
}

export type EndpointStatus = "healthy" | "degraded" | "down";

export function endpointStatus(errors5xx: number, requests: number): EndpointStatus {
  const pct = errorRatePct(errors5xx, requests);
  if (pct >= DOWN_5XX_PCT) return "down";
  if (pct >= DEGRADED_5XX_PCT) return "degraded";
  return "healthy";
}

export function clampRetentionDays(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_RETENTION_DAYS;
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Math.trunc(n)));
}

/** Truncates a timestamp to the start of its minute. */
export function minuteStart(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 60_000) * 60_000);
}

export interface MinuteRow {
  bucketMinute: Date;
  service: string;
  endpoint: string;
  requests: number;
  errors4xx: number;
  errors5xx: number;
  latencySumMs: number;
  latencyBuckets: number[];
}

export interface EndpointRollup {
  service: string;
  endpoint: string;
  requests: number;
  errors4xx: number;
  errors5xx: number;
  latencySumMs: number;
  buckets: number[];
  lastMinute: Date;
}

/** Folds per-minute rows into one rollup per (service, endpoint). */
export function rollupEndpoints(rows: readonly MinuteRow[]): EndpointRollup[] {
  const map = new Map<string, EndpointRollup>();
  for (const r of rows) {
    const key = `${r.service}\u0000${r.endpoint}`;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, {
        service: r.service, endpoint: r.endpoint, requests: r.requests, errors4xx: r.errors4xx,
        errors5xx: r.errors5xx, latencySumMs: r.latencySumMs, buckets: addBuckets(r.latencyBuckets, []),
        lastMinute: r.bucketMinute,
      });
    } else {
      cur.requests += r.requests;
      cur.errors4xx += r.errors4xx;
      cur.errors5xx += r.errors5xx;
      cur.latencySumMs += r.latencySumMs;
      cur.buckets = addBuckets(cur.buckets, r.latencyBuckets);
      if (r.bucketMinute > cur.lastMinute) cur.lastMinute = r.bucketMinute;
    }
  }
  return [...map.values()].sort((a, b) => a.service.localeCompare(b.service) || a.endpoint.localeCompare(b.endpoint));
}

/** The shape the api-monitoring table reads (errorRate = percent 0-100, latencies in ms). */
export function toApiRow(r: EndpointRollup, windowMinutes: number) {
  return {
    service: r.service,
    endpoint: r.endpoint,
    p50Latency: percentileFromBuckets(r.buckets, 0.5),
    p95Latency: percentileFromBuckets(r.buckets, 0.95),
    errorRate: errorRatePct(r.errors5xx, r.requests),
    clientErrorRate: r.requests > 0 ? Math.round((r.errors4xx / r.requests) * 10000) / 100 : 0,
    requests: r.requests,
    requestsPerMin: Math.round((r.requests / Math.max(1, windowMinutes)) * 100) / 100,
    status: endpointStatus(r.errors5xx, r.requests),
    lastRequestAt: new Date(r.lastMinute.getTime() + 60_000).toISOString(),
  };
}
