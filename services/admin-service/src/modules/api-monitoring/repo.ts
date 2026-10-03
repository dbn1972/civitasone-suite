import { and, eq, gte, lt, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead, scopedPlatformRead } from "../../shared/db.js";
import { apiMetricsMinute as M, apiMetricsSettings as S } from "./schema.js";
import { DEFAULT_RETENTION_DAYS, type MinuteRow } from "./domain.js";

type Tx = Pick<Parameters<Parameters<typeof scopedRead>[0]>[0], "insert" | "update" | "delete" | "select">;

/** Hard ceiling on rows read for one request (window x endpoints), so a wide window cannot exhaust memory. */
export const MAX_READ_ROWS = 50_000;

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

function toMinuteRow(r: typeof M.$inferSelect): MinuteRow {
  return {
    bucketMinute: r.bucketMinute, service: r.service, endpoint: r.endpoint, requests: r.requests,
    errors4xx: r.errors4xx, errors5xx: r.errors5xx, latencySumMs: r.latencySumMs, latencyBuckets: r.latencyBuckets,
  };
}

/** The caller's own tenant, under its own RLS scope. */
export async function readOwnMinutes(tenantId: string, since: Date): Promise<MinuteRow[]> {
  const rows = await scopedRead((tx) => tx.select().from(M)
    .where(and(eq(M.tenantId, tenantId), gte(M.bucketMinute, since)))
    .orderBy(M.bucketMinute).limit(MAX_READ_ROWS));
  return rows.map(toMinuteRow);
}

/**
 * Platform-wide read through the SELECT-only platform_bypass policy. ONLY call
 * after the route has authorised a platform super-admin; `tenantId` narrows it
 * to one tenant, omitted means every tenant.
 */
export async function readPlatformMinutes(since: Date, tenantId?: string): Promise<MinuteRow[]> {
  const rows = await scopedPlatformRead((tx) => tx.select().from(M)
    .where(tenantId ? and(eq(M.tenantId, tenantId), gte(M.bucketMinute, since)) : gte(M.bucketMinute, since))
    .orderBy(M.bucketMinute).limit(MAX_READ_ROWS));
  return rows.map(toMinuteRow);
}

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
