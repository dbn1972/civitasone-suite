import { and, eq, gte, lt, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead, scopedPlatformRead } from "../../shared/db.js";
import { apiMetricsMinute as M, apiMetricsSettings as S } from "./schema.js";
import { DEFAULT_RETENTION_DAYS, LATENCY_BUCKET_COUNT, type EndpointRollup } from "./domain.js";

type Tx = Pick<Parameters<Parameters<typeof scopedRead>[0]>[0], "insert" | "update" | "delete" | "select" | "selectDistinct">;

export interface MinuteInsert {
  bucketMinute: Date;
  service: string;
  endpoint: string;
  requests: number;
  errors4xx: number;
  errors5xx: number;
  latencySumMs: number;
  latencyBuckets: number[];
}

/**
 * Additive upsert: several gateway pods flush the same minute, so a conflict
 * ADDS the batch to the stored counts (element-wise for the histogram) instead
 * of replacing them.
 */
export async function addMinute(tx: Tx, tenantId: string, r: MinuteInsert): Promise<void> {
  await tx.insert(M).values({ tenantId, ...r }).onConflictDoUpdate({
    target: [M.tenantId, M.bucketMinute, M.service, M.endpoint],
    set: {
      requests: sql`${M.requests} + excluded.requests`,
      errors4xx: sql`${M.errors4xx} + excluded.errors_4xx`,
      errors5xx: sql`${M.errors5xx} + excluded.errors_5xx`,
      latencySumMs: sql`${M.latencySumMs} + excluded.latency_sum_ms`,
      latencyBuckets: sql`ARRAY(SELECT COALESCE(o, 0) + COALESCE(n, 0) FROM unnest(${M.latencyBuckets}, excluded.latency_buckets) AS u(o, n))`,
      updatedAt: new Date(),
    },
  });
}

/** Distinct (service, endpoint) pairs returned for one read; the rest are reported through `truncated`. */
export const MAX_ENDPOINTS = 2000;

export interface RollupRead {
  rollups: EndpointRollup[];
  /** True when more than MAX_ENDPOINTS endpoints had traffic: the busiest are returned, the quietest left out. */
  truncated: boolean;
}

type Executor = { execute: (q: unknown) => Promise<unknown> };

/**
 * Aggregates IN SQL (per endpoint, not per minute), so a wide window can never silently drop the newest data
 * the way a row LIMIT would. Two bounded queries: totals per endpoint, and the merged histogram per endpoint.
 */
async function aggregate(tx: Executor, since: Date, tenantId?: string, maxEndpoints: number = MAX_ENDPOINTS): Promise<RollupRead> {
  const sinceIso = since.toISOString();
  const where = tenantId
    ? sql`tenant_id = ${tenantId} AND bucket_minute >= ${sinceIso}::timestamptz`
    : sql`bucket_minute >= ${sinceIso}::timestamptz`;
  const totals = (await tx.execute(sql`
    SELECT service, endpoint, sum(requests)::bigint AS requests, sum(errors_4xx)::bigint AS e4, sum(errors_5xx)::bigint AS e5,
           sum(latency_sum_ms)::bigint AS sum_ms, max(bucket_minute) AS last_minute
    FROM health.api_metrics_minute WHERE ${where}
    GROUP BY service, endpoint
    ORDER BY sum(requests) DESC, service, endpoint
    LIMIT ${maxEndpoints + 1}`)) as unknown as Array<Record<string, unknown>>;
  const truncated = totals.length > maxEndpoints;
  const keep = truncated ? totals.slice(0, maxEndpoints) : totals;
  // The histogram is read ONLY for the endpoints kept above, never for the whole window.
  const keptPairs = keep.length === 0 ? sql`FALSE` : sql`(m.service, m.endpoint) IN (${sql.join(keep.map((r) => sql`(${String(r.service)}, ${String(r.endpoint)})`), sql`, `)})`;
  const hist = keep.length === 0 ? [] : (await tx.execute(sql`
    SELECT m.service, m.endpoint, u.i::int AS i, sum(u.n)::bigint AS n
    FROM health.api_metrics_minute m, unnest(m.latency_buckets) WITH ORDINALITY AS u(n, i)
    WHERE ${where} AND ${keptPairs}
    GROUP BY m.service, m.endpoint, u.i`)) as unknown as Array<Record<string, unknown>>;
  const buckets = new Map<string, number[]>();
  for (const h of hist) {
    const key = `${h.service}\u0000${h.endpoint}`;
    const arr = buckets.get(key) ?? new Array<number>(LATENCY_BUCKET_COUNT).fill(0);
    const idx = Number(h.i) - 1;
    if (idx >= 0 && idx < LATENCY_BUCKET_COUNT) arr[idx] = Number(h.n);
    buckets.set(key, arr);
  }
  const rollups = keep.map((r) => ({
    service: String(r.service), endpoint: String(r.endpoint), requests: Number(r.requests), errors4xx: Number(r.e4),
    errors5xx: Number(r.e5), latencySumMs: Number(r.sum_ms),
    buckets: buckets.get(`${r.service}\u0000${r.endpoint}`) ?? new Array<number>(LATENCY_BUCKET_COUNT).fill(0),
    lastMinute: new Date(r.last_minute as string | Date),
  })).sort((a, b) => a.service.localeCompare(b.service) || a.endpoint.localeCompare(b.endpoint));
  return { rollups, truncated };
}

/** The caller's own tenant, under its own RLS scope. */
export function readOwnRollup(tenantId: string, since: Date, maxEndpoints: number = MAX_ENDPOINTS): Promise<RollupRead> {
  return scopedRead((tx) => aggregate(tx as unknown as Executor, since, tenantId, maxEndpoints));
}

/**
 * Platform-wide read through the SELECT-only platform_bypass policy. ONLY call
 * after the route has authorised a platform super-admin; `tenantId` narrows it
 * to one tenant, omitted means every tenant.
 */
export function readPlatformRollup(since: Date, tenantId?: string): Promise<RollupRead> {
  return scopedPlatformRead((tx) => aggregate(tx as unknown as Executor, since, tenantId));
}

/** Distinct (service, endpoint) pairs this tenant has already recorded since the start of the current UTC day. */
export async function endpointsSeenToday(tx: Tx, tenantId: string, now: Date = new Date()): Promise<Set<string>> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const rows = await tx.selectDistinct({ s: M.service, e: M.endpoint }).from(M)
    .where(and(eq(M.tenantId, tenantId), gte(M.bucketMinute, dayStart)));
  return new Set(rows.map((r) => endpointKey(r.s, r.e)));
}

export const endpointKey = (service: string, endpoint: string): string => `${service}\u0000${endpoint}`;

export async function getRetentionDays(tenantId: string): Promise<number> {
  const rows = await scopedRead((tx) => tx.select({ d: S.retentionDays }).from(S).where(eq(S.tenantId, tenantId)).limit(1));
  return rows[0]?.d ?? DEFAULT_RETENTION_DAYS;
}

export async function upsertRetention(tx: Tx, tenantId: string, days: number, actorId: string): Promise<void> {
  await tx.insert(S).values({ tenantId, retentionDays: days, updatedBy: actorId }).onConflictDoUpdate({
    target: S.tenantId,
    set: { retentionDays: days, updatedBy: actorId, updatedAt: new Date(), version: sql`${S.version} + 1` },
  });
}

/**
 * Deletes rollup rows older than each tenant's retention (default 30 days).
 * Runs as a trusted worker job: tenants are discovered through the platform
 * read policy, and every delete runs under that tenant's own RLS scope.
 */
export async function purgeExpired(now: Date = new Date(), defaultDays: number = DEFAULT_RETENTION_DAYS): Promise<{ tenants: number; deleted: number }> {
  const tenants = await scopedPlatformRead((tx) => tx.selectDistinct({ t: M.tenantId }).from(M));
  let deleted = 0;
  for (const { t } of tenants) {
    deleted += await runWithTenant(t, () => db.transaction(async (tx) => {
      const s = await tx.select({ d: S.retentionDays }).from(S).where(eq(S.tenantId, t)).limit(1);
      const days = s[0]?.d ?? defaultDays;
      const cutoff = new Date(now.getTime() - days * 86_400_000);
      const gone = await tx.delete(M).where(and(eq(M.tenantId, t), lt(M.bucketMinute, cutoff))).returning({ m: M.bucketMinute });
      return gone.length;
    }));
  }
  return { tenants: tenants.length, deleted };
}
