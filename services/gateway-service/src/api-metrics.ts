/**
 * In-house API metrics for GET /v1/admin/api-monitoring (GAP-ADMIN-API-MONITORING-06).
 *
 * The collector never touches the request path beyond one O(1) Map update in the
 * onResponse hook: counts and a latency histogram are aggregated per
 * (tenant, minute, service, endpoint) in memory and flushed on a timer as one
 * command per tenant. If the in-memory table is full, or a publish fails, the
 * affected requests are DROPPED and counted (see `dropped`) -- recording must
 * never block, slow or fail a request.
 *
 * The admin-service consumer owns the rollup table; the bucket bounds below MUST
 * match admin-service api-monitoring/domain.ts LATENCY_BOUNDS_MS.
 *
 * Env: GATEWAY_API_METRICS=off disables it; GATEWAY_API_METRICS_FLUSH_MS (default 10000);
 *      GATEWAY_API_METRICS_MAX_KEYS (default 5000).
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { SERVICE_ROUTES } from "./registry.js";

export const LATENCY_BOUNDS_MS = [5, 10, 25, 50, 100, 200, 500, 1000, 2000, 5000, 10000] as const;
const BUCKETS = LATENCY_BOUNDS_MS.length + 1;
export const INGEST_TOPIC = "admin.api_metrics.ingest";
const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";
/** Rows per published command; the consumer accepts up to 2000. */
const MAX_ROWS_PER_COMMAND = 1000;

interface Entry {
  tenantId: string;
  minute: number;
  service: string;
  endpoint: string;
  requests: number;
  errors4xx: number;
  errors5xx: number;
  sumMs: number;
  buckets: number[];
}

export type Publish = (topic: string, envelope: Record<string, unknown>) => Promise<unknown>;

const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[0-9a-f]{16,})$/i;

/** Service routes, longest prefix first, computed once (this runs on every response). */
const ROUTES_BY_PREFIX = [...SERVICE_ROUTES].sort((a, b) => b.prefix.length - a.prefix.length);
/** Path segments kept after the service prefix, e.g. /api/v1/finance + invoices/:id/lines. */
export const SEGMENTS_BELOW_PREFIX = 3;
export const OTHER_SERVICE = "other";
export const OTHER_ENDPOINT = "/other";

/**
 * Groups a request path into (service, endpoint). The service is the gateway registry route the path
 * resolves to; a path that matches no registered route (404s, probes, junk) is bucketed as "other", so a
 * client cannot mint new series by inventing paths. Ids become `:id` and depth is capped at five segments.
 */
export function classifyPath(rawUrl: string): { service: string; endpoint: string } | null {
  const path = rawUrl.split("?")[0] ?? "";
  if (!path.startsWith("/api")) return null;
  const route = ROUTES_BY_PREFIX.find((r) => path === r.prefix || path.startsWith(`${r.prefix}/`));
  if (!route) return { service: OTHER_SERVICE, endpoint: OTHER_ENDPOINT };
  // Depth is capped BELOW the service prefix (at most SEGMENTS_BELOW_PREFIX), so a client cannot mint a new
  // series per invented path word under a registered prefix.
  const prefixLen = route.prefix.split("/").filter(Boolean).length;
  const parts = path.split("/").filter(Boolean).slice(0, prefixLen + SEGMENTS_BELOW_PREFIX).map((s) => (ID_SEGMENT.test(s) ? ":id" : s));
  return { service: route.name.slice(0, 64), endpoint: `/${parts.join("/")}`.slice(0, 200) };
}

export function bucketIndex(ms: number): number {
  for (let i = 0; i < LATENCY_BOUNDS_MS.length; i++) if (ms <= (LATENCY_BOUNDS_MS[i] as number)) return i;
  return LATENCY_BOUNDS_MS.length;
}

export class ApiMetricsCollector {
  private table = new Map<string, Entry>();
  /** Distinct series held per tenant in the current table, so one tenant cannot fill it for everyone. */
  private perTenant = new Map<string, number>();
  private inFlight: Promise<void> | null = null;
  /** Requests not recorded: table full, or the publish for them failed. */
  dropped = 0;

  constructor(
    private readonly publish: Publish,
    private readonly maxKeys = 5000,
    private readonly now: () => number = Date.now,
    private readonly maxKeysPerTenant = Number(process.env.GATEWAY_API_METRICS_MAX_KEYS_PER_TENANT ?? 200),
  ) {}

  get size(): number { return this.table.size; }

  record(tenantId: string, rawUrl: string, status: number, durationMs: number): void {
    let c = classifyPath(rawUrl);
    if (!c) return;
    const minute = Math.floor(this.now() / 60_000) * 60_000;
    let key = `${tenantId}|${minute}|${c.service}|${c.endpoint}`;
    let e = this.table.get(key);
    if (!e && (this.perTenant.get(tenantId) ?? 0) >= this.maxKeysPerTenant) {
      // This tenant has used its share of series: fold further new endpoints into one overflow series per service.
      c = { service: c.service, endpoint: OTHER_ENDPOINT };
      key = `${tenantId}|${minute}|${c.service}|${c.endpoint}`;
      e = this.table.get(key);
    }
    if (!e) {
      if (this.table.size >= this.maxKeys) { this.dropped++; return; }
      e = { tenantId, minute, service: c.service, endpoint: c.endpoint, requests: 0, errors4xx: 0, errors5xx: 0, sumMs: 0, buckets: new Array<number>(BUCKETS).fill(0) };
      this.table.set(key, e);
      this.perTenant.set(tenantId, (this.perTenant.get(tenantId) ?? 0) + 1);
    }
    const ms = Math.max(0, Math.round(durationMs));
    e.requests++;
    if (status >= 500) e.errors5xx++;
    else if (status >= 400) e.errors4xx++;
    e.sumMs += ms;
    e.buckets[bucketIndex(ms)]!++;
  }

  /**
   * Swaps the table out and publishes one command per tenant. Never throws. A flush that is still running
   * (slow queue) is joined, not overlapped, so timer ticks cannot pile up publishes.
   */
  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.doFlush().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async doFlush(): Promise<void> {
    if (this.table.size === 0) return;
    const batch = this.table;
    this.table = new Map();
    this.perTenant = new Map();
    const byTenant = new Map<string, Entry[]>();
    for (const e of batch.values()) {
      const list = byTenant.get(e.tenantId);
      if (list) list.push(e); else byTenant.set(e.tenantId, [e]);
    }
    for (const [tenantId, entries] of byTenant) {
      for (let i = 0; i < entries.length; i += MAX_ROWS_PER_COMMAND) {
        const chunk = entries.slice(i, i + MAX_ROWS_PER_COMMAND);
        try {
          await this.publish(INGEST_TOPIC, {
            messageId: randomUUID(),
            type: INGEST_TOPIC,
            tenantId,
            actorId: SYSTEM_ACTOR,
            correlationId: randomUUID(),
            schemaVersion: "1.0",
            payload: {
              rows: chunk.map((e) => ({
                minute: new Date(e.minute).toISOString(), service: e.service, endpoint: e.endpoint,
                requests: e.requests, errors4xx: e.errors4xx, errors5xx: e.errors5xx, sumMs: e.sumMs, buckets: e.buckets,
              })),
            },
          });
        } catch {
          this.dropped += chunk.reduce((n, e) => n + e.requests, 0);
        }
      }
    }
  }
}

/** The tenant a request may be attributed to: only a server-verified one, never a raw header. */
function verifiedTenant(req: FastifyRequest): string | null {
  const jwtTid = (req as FastifyRequest & { jwtPayload?: { tid?: string } }).jwtPayload?.tid;
  if (jwtTid) return jwtTid;
  if ((req as FastifyRequest & { apiKeyAuthenticated?: boolean }).apiKeyAuthenticated) {
    const h = req.headers["x-tenant-id"];
    if (typeof h === "string" && h) return h;
  }
  return null;
}

export function registerApiMetrics(app: FastifyInstance, publish: Publish): ApiMetricsCollector | null {
  if ((process.env.GATEWAY_API_METRICS ?? "on").toLowerCase() === "off") return null;
  const collector = new ApiMetricsCollector(publish, Number(process.env.GATEWAY_API_METRICS_MAX_KEYS ?? 5000));
  app.addHook("onResponse", (req, reply, done) => {
    try {
      const tid = verifiedTenant(req);
      if (tid) collector.record(tid, req.url, reply.statusCode, reply.elapsedTime);
    } catch { /* metrics must never affect a response */ }
    done();
  });
  const timer = setInterval(() => { void collector.flush(); }, Number(process.env.GATEWAY_API_METRICS_FLUSH_MS ?? 10_000));
  timer.unref();
  // A flush may already be running: join it, then flush whatever was recorded meanwhile.
  app.addHook("onClose", async () => { clearInterval(timer); await collector.flush(); await collector.flush(); });
  return collector;
}
