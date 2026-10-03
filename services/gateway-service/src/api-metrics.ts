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

/**
 * Groups a request path into (service, endpoint). Ids become `:id` so the
 * endpoint set stays small; unknown shapes return null and are not recorded.
 */
export function classifyPath(rawUrl: string): { service: string; endpoint: string } | null {
  const path = rawUrl.split("?")[0] ?? "";
  const seg = path.split("/").filter(Boolean);
  if (seg[0] !== "api" || seg.length < 2) return null;
  const versioned = /^v\d+$/.test(seg[1] ?? "");
  const service = versioned ? seg[2] : seg[1];
  if (!service || ID_SEGMENT.test(service)) return null;
  const parts = seg.slice(0, 5).map((s) => (ID_SEGMENT.test(s) ? ":id" : s));
  return { service: service.slice(0, 64), endpoint: `/${parts.join("/")}`.slice(0, 200) };
}

export function bucketIndex(ms: number): number {
  for (let i = 0; i < LATENCY_BOUNDS_MS.length; i++) if (ms <= (LATENCY_BOUNDS_MS[i] as number)) return i;
  return LATENCY_BOUNDS_MS.length;
}

export class ApiMetricsCollector {
  private table = new Map<string, Entry>();
  /** Requests not recorded: table full, or the publish for them failed. */
  dropped = 0;

  constructor(private readonly publish: Publish, private readonly maxKeys = 5000, private readonly now: () => number = Date.now) {}

  get size(): number { return this.table.size; }

  record(tenantId: string, rawUrl: string, status: number, durationMs: number): void {
    const c = classifyPath(rawUrl);
    if (!c) return;
    const minute = Math.floor(this.now() / 60_000) * 60_000;
    const key = `${tenantId}|${minute}|${c.service}|${c.endpoint}`;
    let e = this.table.get(key);
    if (!e) {
      if (this.table.size >= this.maxKeys) { this.dropped++; return; }
      e = { tenantId, minute, service: c.service, endpoint: c.endpoint, requests: 0, errors4xx: 0, errors5xx: 0, sumMs: 0, buckets: new Array<number>(BUCKETS).fill(0) };
      this.table.set(key, e);
    }
    const ms = Math.max(0, Math.round(durationMs));
    e.requests++;
    if (status >= 500) e.errors5xx++;
    else if (status >= 400) e.errors4xx++;
    e.sumMs += ms;
    e.buckets[bucketIndex(ms)]!++;
  }

  /** Swaps the table out and publishes one command per tenant. Never throws. */
  async flush(): Promise<void> {
    if (this.table.size === 0) return;
    const batch = this.table;
    this.table = new Map();
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
  app.addHook("onClose", async () => { clearInterval(timer); await collector.flush(); });
  return collector;
}
