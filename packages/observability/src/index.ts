// Shared structured-log/report redaction sanitizer (Req 15.4, 3.5, 4.4, 13.1, 13.4) —
// used by the Provisioning_Actuator, Read_Router, connection-budget verification
// check, and Drill_Scheduler before emitting logs/persisting Drill_Report artifacts.
export { redactLogPayload, redactReportPayload, type RedactionMode } from "./redaction.js";

type AppLike = {
  get: (path: string, handler: (...args: unknown[]) => unknown) => void;
  addHook: (name: string, handler: (...args: unknown[]) => unknown) => void;
  routes?: Array<{ method: string | string[]; url: string }>;
};

/** Recursively stringify BigInt fields for JSON responses (Drizzle money columns). */
export function jsonSafe<T>(value: T): T {
  if (typeof value === "bigint") return value.toString() as unknown as T;
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item)) as unknown as T;
  if (typeof value === "object") {
    if (value instanceof Date) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = jsonSafe(v);
    }
    return out as T;
  }
  return value;
}

type CacheLike = {
  put: (key: string, value: unknown, ttl?: number) => Promise<void>;
};

type QueueLike = {
  healthCheck: () => Promise<{ healthy: boolean }>;
};

export type ReadinessChecks = {
  db?: { ping: () => Promise<boolean> };
  cache?: CacheLike;
  queue?: QueueLike;
  // 09-T4: custom checks may be sync (e.g. consumerHeartbeatCheck reads an
  // in-memory timestamp) or async. /ready awaits either form.
  custom?: Array<{ name: string; ping: () => boolean | Promise<boolean> }>;
};

export type OpsOptions = {
  service: string;
  version?: string;
  checks?: ReadinessChecks;
};

const startedAt = Date.now();
let requestCount = 0;

// 09-T2: gate /metrics centrally for every service. Mirrors the gateway guard
// (services/gateway-service/src/app.ts) so the rule lives in one place. Kept
// internal — do NOT import from the gateway (packages must not depend on services).
function isInternalIP(ip: string): boolean {
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    /^10\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^192\.168\./.test(ip)
  );
}

const notificationDeliveryTotal = new Map<string, number>();

/** Increment notification_delivery_total{channel,status}. */
export function incrementNotificationDelivery(channel: string, status: "success" | "failed"): void {
  const key = `${channel}:${status}`;
  notificationDeliveryTotal.set(key, (notificationDeliveryTotal.get(key) ?? 0) + 1);
}

/** Reset delivery counters — test helper. */
export function resetNotificationDeliveryMetrics(): void {
  notificationDeliveryTotal.clear();
}

function formatNotificationDeliveryMetrics(): string[] {
  const lines = [
    "# HELP notification_delivery_total Notifications delivered by channel and status",
    "# TYPE notification_delivery_total counter",
  ];
  for (const [key, count] of notificationDeliveryTotal) {
    const sep = key.lastIndexOf(":");
    const channel = key.slice(0, sep);
    const status = key.slice(sep + 1);
    lines.push(`notification_delivery_total{channel="${channel}",status="${status}"} ${count}`);
  }
  return lines;
}

// QUE-1: queue consumer error counter. Incremented whenever a subscribed
// handler throws, so silent message-handling failures become observable.
const consumerErrorsTotal = new Map<string, number>();

/** Increment consumer_errors_total{service,topic}. */
export function incrementConsumerError(service: string, topic: string): void {
  const key = `${service}:${topic}`;
  consumerErrorsTotal.set(key, (consumerErrorsTotal.get(key) ?? 0) + 1);
}

/** Read current count — test helper. */
export function getConsumerErrorCount(service: string, topic: string): number {
  return consumerErrorsTotal.get(`${service}:${topic}`) ?? 0;
}

/** Reset consumer error counters — test helper. */
export function resetConsumerErrorMetrics(): void {
  consumerErrorsTotal.clear();
}

function formatConsumerErrorMetrics(): string[] {
  const lines = [
    "# HELP consumer_errors_total Queue consumer handler exceptions by service and topic",
    "# TYPE consumer_errors_total counter",
  ];
  for (const [key, count] of consumerErrorsTotal) {
    const sep = key.indexOf(":");
    const service = key.slice(0, sep);
    const topic = key.slice(sep + 1);
    lines.push(`consumer_errors_total{service="${service}",topic="${topic}"} ${count}`);
  }
  return lines;
}

// ── 09-T4: consumer liveness / heartbeat ─────────────────────────────────────
// A *-worker process records a heartbeat on every successful poll-loop
// iteration. Readiness then reflects whether the poll loop is still alive: if
// the loop stops (crash, hang, killed task) the timestamp goes stale and the
// readiness check flips /ready to 503 so orchestrators stop routing to it.

const consumerLastPoll = new Map<string, number>(); // service -> epoch ms

/** Record a successful consumer poll for `service` (call each receive loop iteration). */
export function recordConsumerHeartbeat(service: string): void {
  consumerLastPoll.set(service, Date.now());
}

/**
 * Last poll timestamp (epoch ms) for `service`, or the most recent across all
 * services when `service` is omitted. Returns null when no heartbeat recorded.
 */
export function getLastConsumerHeartbeat(service?: string): number | null {
  if (service !== undefined) return consumerLastPoll.get(service) ?? null;
  let max: number | null = null;
  for (const ts of consumerLastPoll.values()) {
    if (max === null || ts > max) max = ts;
  }
  return max;
}

/** Reset heartbeats — test helper. */
export function resetConsumerHeartbeats(): void {
  consumerLastPoll.clear();
}

/**
 * Build a readiness ping that returns false when the consumer has not polled
 * within `maxStalenessMs` (or has never polled). Wire it into registerOpsRoutes:
 *
 *   registerOpsRoutes(app, {
 *     service: "finance-worker",
 *     checks: { custom: [{ name: "consumer", ping: consumerHeartbeatCheck({ maxStalenessMs: 90_000, service: "finance-worker" }) }] },
 *   });
 *
 * Killing the poll loop lets the timestamp go stale → ping() returns false →
 * /ready responds 503.
 */
export function consumerHeartbeatCheck(opts: { maxStalenessMs: number; service?: string }): () => boolean {
  return () => {
    const last = getLastConsumerHeartbeat(opts.service);
    if (last === null) return false;
    return Date.now() - last <= opts.maxStalenessMs;
  };
}

function formatConsumerHeartbeatMetrics(): string[] {
  const lines = [
    "# HELP consumer_last_poll_timestamp Unix time (seconds) of the last successful consumer poll by service",
    "# TYPE consumer_last_poll_timestamp gauge",
  ];
  for (const [service, ts] of consumerLastPoll) {
    lines.push(`consumer_last_poll_timestamp{service="${service}"} ${Math.floor(ts / 1000)}`);
  }
  return lines;
}

// ── OPS-1 (09-T1): outbox relay + DLQ failure metrics ────────────────────────

const outboxRelayFailuresTotal = new Map<string, number>(); // service -> count
const dlqMessagesTotal = new Map<string, number>();          // topic -> count
const capturedErrorsTotal = new Map<string, number>();       // service -> count

/** Increment outbox_relay_failures_total{service}. */
export function incrementOutboxRelayFailure(service: string): void {
  outboxRelayFailuresTotal.set(service, (outboxRelayFailuresTotal.get(service) ?? 0) + 1);
}

/** Increment dlq_messages_total{topic}. */
export function incrementDlqMessage(topic: string): void {
  dlqMessagesTotal.set(topic, (dlqMessagesTotal.get(topic) ?? 0) + 1);
}

export function getOutboxRelayFailureCount(service: string): number {
  return outboxRelayFailuresTotal.get(service) ?? 0;
}
export function getDlqMessageCount(topic: string): number {
  return dlqMessagesTotal.get(topic) ?? 0;
}
export function resetFailureMetrics(): void {
  outboxRelayFailuresTotal.clear();
  dlqMessagesTotal.clear();
  capturedErrorsTotal.clear();
}

function formatFailureMetrics(): string[] {
  const lines = [
    "# HELP outbox_relay_failures_total Transactional outbox relay failures by service",
    "# TYPE outbox_relay_failures_total counter",
  ];
  for (const [service, count] of outboxRelayFailuresTotal) {
    lines.push(`outbox_relay_failures_total{service="${service}"} ${count}`);
  }
  lines.push(
    "# HELP dlq_messages_total Messages routed to a dead-letter queue by topic",
    "# TYPE dlq_messages_total counter",
  );
  for (const [topic, count] of dlqMessagesTotal) {
    lines.push(`dlq_messages_total{topic="${topic}"} ${count}`);
  }
  lines.push(
    "# HELP captured_errors_total Failures captured via captureError(), by service",
    "# TYPE captured_errors_total counter",
  );
  for (const [service, count] of capturedErrorsTotal) {
    lines.push(`captured_errors_total{service="${service}"} ${count}`);
  }
  return lines;
}

// ── OPS-1 (09-T1): error capture ─────────────────────────────────────────────
// Single hook for failures so they become observable: structured log + metric +
// optional forward to Sentry/OpenTelemetry when configured (no hard dependency,
// so the platform stays installable without a DSN). Wire an exporter via
// setErrorReporter() at service startup when SENTRY_DSN / OTEL is configured.

export type ErrorContext = {
  service?: string;
  topic?: string;
  correlationId?: string;
  [k: string]: unknown;
};

type ErrorReporter = (err: unknown, ctx: ErrorContext) => void;
let _errorReporter: ErrorReporter | null = null;
let _capturedErrors = 0;

/** Register an external error reporter (e.g. Sentry.captureException). */
export function setErrorReporter(reporter: ErrorReporter): void {
  _errorReporter = reporter;
}

export function getCapturedErrorCount(): number {
  return _capturedErrors;
}
/** Captured-error count for a single service label (as exposed on /metrics). */
export function getCapturedErrorCountByService(service: string): number {
  return capturedErrorsTotal.get(service) ?? 0;
}
export function resetCapturedErrors(): void {
  _capturedErrors = 0;
}

/**
 * Capture a failure: always emits a structured error log + counts it; forwards
 * to the registered reporter when one is configured. The single place where
 * "invisible failures" become visible.
 */
export function captureError(err: unknown, ctx: ErrorContext = {}): void {
  _capturedErrors++;
  // OPS-1: also expose as a Prometheus counter so the failure is scrapeable and
  // alertable (alert.rules.yml CapturedErrorsAppearing), not just a log line.
  const svc = ctx.service ?? "unknown";
  capturedErrorsTotal.set(svc, (capturedErrorsTotal.get(svc) ?? 0) + 1);
  const stack = err instanceof Error ? err.stack : String(err);
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({ level: "error", event: "captured_error", ...ctx, err: stack }),
  );
  if (_errorReporter) {
    try { _errorReporter(err, ctx); } catch { /* never let reporting throw */ }
  }
}

/**
 * Call once at service startup. If SENTRY_DSN is configured AND @sentry/node is
 * installed, wires Sentry as the error reporter; otherwise stays log-only (so
 * the platform runs with no DSN and no hard dependency). Returns the mode used.
 */
export async function initErrorReporting(service: string): Promise<"sentry" | "log-only"> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return "log-only";
  try {
    // Dynamic, optional import — absent dependency degrades to log-only.
    const Sentry = (await import("@sentry/node" as string)) as {
      init: (o: Record<string, unknown>) => void;
      captureException: (e: unknown, hint?: unknown) => void;
    };
    Sentry.init({ dsn, environment: process.env.NODE_ENV ?? "production", serverName: service });
    setErrorReporter((err, ctx) => Sentry.captureException(err, { extra: ctx }));
    return "sentry";
  } catch {
    return "log-only";
  }
}

// ── PERF-1: HTTP request latency histogram (Charter §28.2 / §38 p95 SLOs) ────
// Per (service, method, route-template) histogram so latency SLOs become
// measurable, not aspirational. Route TEMPLATES (e.g. /v1/estab/files/{id}) are
// used — never the raw URL — so cardinality stays bounded. Exposed as a
// Prometheus histogram on /metrics AND queryable in-process for tests/SLO checks.

// Upper bucket bounds in milliseconds (last bucket is +Inf, tracked separately).
const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000, 2000, 5000];

type LatencyHist = { buckets: number[]; sum: number; count: number };
const httpLatency = new Map<string, LatencyHist>(); // "service|method|route" -> hist
// Per-request start stamps, keyed by the request object (no mutation of typed objects).
const reqStart = new WeakMap<object, number>();

function latencyKey(service: string, method: string, route: string): string {
  return `${service}|${method}|${route}`;
}

/**
 * Record one observed request latency (ms) for a service/method/route template.
 * Exported so workers or custom transports can record latencies directly.
 */
export function recordHttpLatency(service: string, method: string, route: string, ms: number): void {
  const key = latencyKey(service, method, route);
  let h = httpLatency.get(key);
  if (!h) {
    h = { buckets: new Array(LATENCY_BUCKETS_MS.length + 1).fill(0), sum: 0, count: 0 };
    httpLatency.set(key, h);
  }
  h.sum += ms;
  h.count += 1;
  let placed = false;
  for (let i = 0; i < LATENCY_BUCKETS_MS.length; i++) {
    if (ms <= LATENCY_BUCKETS_MS[i]!) { h.buckets[i]! += 1; placed = true; break; }
  }
  if (!placed) h.buckets[LATENCY_BUCKETS_MS.length]! += 1; // +Inf bucket
}

/**
 * Estimate a latency quantile (0<q<1) in ms from the histogram, with linear
 * interpolation inside the matched bucket. Returns null when no samples exist.
 * Aggregates across all routes of a service when `method`/`route` are omitted.
 */
export function getHttpLatencyQuantile(service: string, q: number, method?: string, route?: string): number | null {
  const agg = new Array(LATENCY_BUCKETS_MS.length + 1).fill(0);
  let total = 0;
  for (const [key, h] of httpLatency) {
    const [svc, m, r] = key.split("|");
    if (svc !== service) continue;
    if (method !== undefined && m !== method) continue;
    if (route !== undefined && r !== route) continue;
    for (let i = 0; i < agg.length; i++) agg[i] += h.buckets[i]!;
    total += h.count;
  }
  if (total === 0) return null;
  const rank = q * total;
  let cumulative = 0;
  for (let i = 0; i < agg.length; i++) {
    const prev = cumulative;
    cumulative += agg[i]!;
    if (cumulative >= rank) {
      const lower = i === 0 ? 0 : LATENCY_BUCKETS_MS[i - 1]!;
      const upper = i < LATENCY_BUCKETS_MS.length ? LATENCY_BUCKETS_MS[i]! : LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1]!;
      const inBucket = agg[i]!;
      if (inBucket === 0) return upper;
      const frac = (rank - prev) / inBucket;
      return Math.round(lower + (upper - lower) * frac);
    }
  }
  return LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1]!;
}

/** Total observed request count for a service (test helper). */
export function getHttpLatencyCount(service: string): number {
  let total = 0;
  for (const [key, h] of httpLatency) {
    if (key.split("|")[0] === service) total += h.count;
  }
  return total;
}

/** Reset latency histograms — test helper. */
export function resetHttpLatencyMetrics(): void {
  httpLatency.clear();
}

function formatHttpLatencyMetrics(): string[] {
  const lines = [
    "# HELP http_request_duration_ms Request latency by service, method and route template",
    "# TYPE http_request_duration_ms histogram",
  ];
  for (const [key, h] of httpLatency) {
    const [service, method, route] = key.split("|");
    const labels = `service="${service}",method="${method}",route="${route}"`;
    let cumulative = 0;
    for (let i = 0; i < LATENCY_BUCKETS_MS.length; i++) {
      cumulative += h.buckets[i]!;
      lines.push(`http_request_duration_ms_bucket{${labels},le="${LATENCY_BUCKETS_MS[i]}"} ${cumulative}`);
    }
    cumulative += h.buckets[LATENCY_BUCKETS_MS.length]!;
    lines.push(`http_request_duration_ms_bucket{${labels},le="+Inf"} ${cumulative}`);
    lines.push(`http_request_duration_ms_sum{${labels}} ${h.sum}`);
    lines.push(`http_request_duration_ms_count{${labels}} ${h.count}`);
  }
  return lines;
}

/** Best-effort route template for a Fastify request (bounded cardinality). */
function routeTemplate(request: unknown): string {
  const r = request as { routeOptions?: { url?: string }; routerPath?: string; method?: string };
  return r.routeOptions?.url ?? r.routerPath ?? "unmatched";
}

// ── PERF-2: per-tenant request counter (Charter §28.6 noisy-neighbor / T6) ───
// Counts requests per (service, tenant) so a single tenant's request storm is
// visible and alertable (noisy-neighbor). Cardinality is hard-capped: once a
// service has seen MAX_TENANT_LABELS distinct tenants, further tenants fold into
// the "_overflow" label so an attacker can't explode label cardinality.
const MAX_TENANT_LABELS = 1000;
const tenantRequestsTotal = new Map<string, number>(); // "service|tenant" -> count
const tenantLabelCount = new Map<string, number>();     // service -> distinct tenant labels

/** Increment http_requests_by_tenant_total{service,tenant} (cardinality-capped). */
export function recordTenantRequest(service: string, tenantId: string): void {
  if (!tenantId) return;
  let label = tenantId;
  const direct = `${service}|${label}`;
  if (!tenantRequestsTotal.has(direct)) {
    const seen = tenantLabelCount.get(service) ?? 0;
    if (seen >= MAX_TENANT_LABELS) {
      label = "_overflow";
    } else {
      tenantLabelCount.set(service, seen + 1);
    }
  }
  const key = `${service}|${label}`;
  tenantRequestsTotal.set(key, (tenantRequestsTotal.get(key) ?? 0) + 1);
}

/** Request count for a (service, tenant) — test helper. */
export function getTenantRequestCount(service: string, tenantId: string): number {
  return tenantRequestsTotal.get(`${service}|${tenantId}`) ?? 0;
}

/** Reset per-tenant counters — test helper. */
export function resetTenantRequestMetrics(): void {
  tenantRequestsTotal.clear();
  tenantLabelCount.clear();
}

function formatTenantRequestMetrics(): string[] {
  const lines = [
    "# HELP http_requests_by_tenant_total HTTP requests by service and tenant (noisy-neighbor)",
    "# TYPE http_requests_by_tenant_total counter",
  ];
  for (const [key, count] of tenantRequestsTotal) {
    const sep = key.indexOf("|");
    const service = key.slice(0, sep);
    const tenant = key.slice(sep + 1);
    lines.push(`http_requests_by_tenant_total{service="${service}",tenant="${tenant}"} ${count}`);
  }
  return lines;
}

/** Read the resolved tenant id from a request if the auth plugin set req.ctx. */
function requestTenant(request: unknown): string {
  const r = request as { ctx?: { tenantId?: string } };
  return r.ctx?.tenantId ?? "";
}

/** Standard /health /ready /metrics /openapi.json for every service. */
export function registerOpsRoutes(app: AppLike, opts: OpsOptions): void {
  const version = opts.version ?? process.env.npm_package_version ?? "0.1.0";

  app.addHook("preSerialization", async (_request, _reply, payload) => jsonSafe(payload));

  // PERF-1: stamp request start, then record latency per route template on
  // response. WeakMap-keyed so we never mutate the framework's typed objects.
  app.addHook("onRequest", async (...args: unknown[]) => {
    const request = args[0] as object;
    if (request) reqStart.set(request, performance.now());
  });

  app.addHook("onResponse", async (...args: unknown[]) => {
    requestCount++;
    const request = args[0] as (object & { method?: string }) | undefined;
    const reply = args[1] as { elapsedTime?: number } | undefined;
    if (!request) return;
    const start = reqStart.get(request);
    const elapsed = typeof reply?.elapsedTime === "number"
      ? reply.elapsedTime
      : start !== undefined ? performance.now() - start : null;
    if (elapsed === null) return;
    recordHttpLatency(opts.service, (request.method ?? "GET").toUpperCase(), routeTemplate(request), elapsed);
    recordTenantRequest(opts.service, requestTenant(request));
  });

  app.get("/health", async () => ({
    service: opts.service,
    status: "ok",
    version,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  }));

  app.get("/ready", async (...args: unknown[]) => {
    const reply = args[1] as { code: (n: number) => { send: (b: unknown) => void } };
    const results: Record<string, boolean> = {};
    if (opts.checks?.db) {
      try { results.db = await opts.checks.db.ping(); } catch { results.db = false; }
    }
    if (opts.checks?.cache) {
      try {
        await opts.checks.cache.put(`ready:${opts.service}`, "1", 5);
        results.redis = true;
      } catch { results.redis = false; }
    }
    if (opts.checks?.queue) {
      try {
        const h = await opts.checks.queue.healthCheck();
        results.queue = h.healthy;
      } catch { results.queue = false; }
    }
    if (opts.checks?.custom) {
      for (const c of opts.checks.custom) {
        try { results[c.name] = await c.ping(); } catch { results[c.name] = false; }
      }
    }
    const required = Object.values(results);
    const ready = required.length === 0 || required.every(Boolean);
    if (!ready) {
      return reply.code(503).send({ status: "not_ready", checks: results });
    }
    return { status: "ready", checks: results };
  });

  app.get("/metrics", async (...args: unknown[]) => {
    const request = args[0] as { headers: Record<string, unknown>; ip: string };
    const reply = args[1] as {
      type: (t: string) => { send: (b: string) => void };
      code: (n: number) => { send: (b: unknown) => void };
    };
    // 09-T2: protect /metrics on every service. When METRICS_TOKEN is set, require
    // the x-metrics-token header to match; otherwise allow only internal-IP sources.
    // Prometheus scrapes are permitted because they originate from internal IPs
    // (see infra/observability/prometheus.yml) or carry METRICS_TOKEN.
    const metricsToken = process.env.METRICS_TOKEN;
    if (metricsToken) {
      if (request.headers["x-metrics-token"] !== metricsToken) {
        return reply.code(403).send({ code: "FORBIDDEN", message: "metrics access denied" });
      }
    } else if (!isInternalIP(request.ip)) {
      return reply.code(403).send({ code: "FORBIDDEN", message: "metrics access denied" });
    }
    const lines = [
      "# HELP service_up Service process is running",
      "# TYPE service_up gauge",
      `service_up{service="${opts.service}"} 1`,
      "# HELP http_requests_total Total HTTP requests since start",
      "# TYPE http_requests_total counter",
      `http_requests_total{service="${opts.service}"} ${requestCount}`,
      "# HELP process_uptime_seconds Process uptime",
      "# TYPE process_uptime_seconds gauge",
      `process_uptime_seconds{service="${opts.service}"} ${Math.floor((Date.now() - startedAt) / 1000)}`,
      ...formatNotificationDeliveryMetrics(),
      ...formatConsumerErrorMetrics(),
      ...formatConsumerHeartbeatMetrics(),
      ...formatFailureMetrics(),
      ...formatHttpLatencyMetrics(),
      ...formatTenantRequestMetrics(),
    ];
    return reply.type("text/plain; version=0.0.4").send(lines.join("\n") + "\n");
  });

  app.addHook("onReady", async () => {
    const routes = (app as { routes?: Array<{ method: string | string[]; url: string }> }).routes ?? [];
    const paths: Record<string, Record<string, unknown>> = {};
    for (const r of routes) {
      const methods = Array.isArray(r.method) ? r.method : [r.method];
      const path = r.url.replace(/:(\w+)/g, "{$1}");
      paths[path] ??= {};
      for (const m of methods) {
        const ml = m.toLowerCase();
        paths[path][ml] = {
          summary: `${m} ${path}`,
          responses: ml === "get"
            ? { "200": { description: "OK" } }
            : { "202": { description: "Accepted" }, "200": { description: "OK" } },
        };
      }
    }
    (app as AppLike & { _openApi?: unknown })._openApi = {
      openapi: "3.0.3",
      info: { title: opts.service, version },
      paths,
    };
  });

  app.get("/openapi.json", async () => {
    return (app as AppLike & { _openApi?: unknown })._openApi ?? {
      openapi: "3.0.3",
      info: { title: opts.service, version },
      paths: {},
    };
  });
}

/** SQL ping for postgres.js clients. */
export async function dbPing(sql: unknown): Promise<boolean> {
  const client = sql as { (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> };
  await client`SELECT 1`;
  return true;
}
