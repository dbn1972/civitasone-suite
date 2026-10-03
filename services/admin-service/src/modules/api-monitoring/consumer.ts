/**
 * Writers for the API metrics rollup. Each handler runs in ONE transaction
 * under the message's tenant GUC and is idempotent through _inbox.processed.
 */
import { z } from "zod";
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { auditEvent } from "../../shared/audit.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { LATENCY_BUCKET_COUNT, MAX_RETENTION_DAYS, MIN_RETENTION_DAYS, minuteStart } from "./domain.js";

const log = pino({ name: "admin-api-monitoring-consumer" });

const count = z.number().int().min(0).max(2_000_000_000);
export const ingestRow = z.object({
  minute: z.string().datetime(),
  service: z.string().min(1).max(64),
  endpoint: z.string().min(1).max(200),
  requests: count.min(1),
  errors4xx: count,
  errors5xx: count,
  sumMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  buckets: z.array(count).length(LATENCY_BUCKET_COUNT),
}).refine((r) => r.errors4xx + r.errors5xx <= r.requests, { message: "errors exceed requests" })
  .refine((r) => r.buckets.reduce((a, b) => a + b, 0) === r.requests, { message: "histogram does not add up to requests" });

/** Rows are checked one by one: a bad row is skipped (and counted in the log), the good rows of the batch still apply. */
export const ingestPayload = z.object({ rows: z.array(z.unknown()).max(2000) });

const retentionPayload = z.object({
  id: z.string().uuid(),
  retentionDays: z.number().int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS),
});

/**
 * Distinct (service, endpoint) pairs one tenant may record per UTC day (default 500, env
 * API_METRICS_MAX_ENDPOINTS_PER_TENANT_DAY). A tenant over the cap has further NEW endpoints folded into the
 * "other" series; folded rows are counted (folded total in the log line, and in foldedRowCount()).
 */
export const OTHER_SERVICE = "other";
export const OTHER_ENDPOINT = "/other";
let folded = 0;
export const foldedRowCount = (): number => folded;
/**
 * Per-tenant, per-UTC-day cache of the endpoints already recorded, so the common ingest path does not run a
 * SELECT DISTINCT over a day of rows every few seconds. Loaded once per tenant per day, grown as rows are
 * stored (after the transaction commits), and replaced at day rollover.
 *
 * Several consumer processes may each hold a cache and see a different part of the traffic, so a cache miss is
 * never trusted when it would FOLD an endpoint: the first time a message is about to fold, the day's set is
 * reloaded ONCE for that tenant and every row of the message is decided against it, so a message full of
 * invented endpoints costs one query, not one per row. An endpoint already recorded is never folded. (The cap itself stays soft: two
 * processes can each admit a few new endpoints before either sees the other's.)
 */
interface DayCache { day: string; seen: Set<string> }
const dayCaches = new Map<string, DayCache>();
const MAX_CACHED_TENANTS = 5000;
let cacheLoads = 0;
let seenQueries = 0;
let clock: () => Date = () => new Date();
export const endpointCacheLoads = (): number => cacheLoads;
/** Every database read of the day's endpoint set (cache loads and fold reloads). */
export const endpointSeenQueries = (): number => seenQueries;
/** Test hooks. */
export function resetEndpointCache(): void { dayCaches.clear(); }
export function setEndpointClock(fn: (() => Date) | null): void { clock = fn ?? (() => new Date()); }
const utcDay = (d: Date): string => d.toISOString().slice(0, 10);

type SeenTx = Parameters<typeof repo.endpointsSeenToday>[0];
async function cachedSeen(tx: SeenTx, tenantId: string, now: Date): Promise<Set<string>> {
  const day = utcDay(now);
  const hit = dayCaches.get(tenantId);
  if (hit && hit.day === day) return hit.seen;
  const seen = await repo.endpointsSeenToday(tx, tenantId, now);
  cacheLoads++;
  seenQueries++;
  if (dayCaches.size >= MAX_CACHED_TENANTS) {
    // drop entries from earlier days first, then the oldest inserted, so the map stays bounded
    for (const [k, v] of dayCaches) if (v.day !== day) dayCaches.delete(k);
    if (dayCaches.size >= MAX_CACHED_TENANTS) dayCaches.delete(dayCaches.keys().next().value as string);
  }
  dayCaches.set(tenantId, { day, seen });
  return seen;
}

const endpointCap = (): number => Number(process.env.API_METRICS_MAX_ENDPOINTS_PER_TENANT_DAY ?? 500);

/** Rows older than the longest retention, or minutes in the future, are noise from a skewed clock: drop them. */
const MAX_AGE_MS = MAX_RETENTION_DAYS * 86_400_000;
const MAX_FUTURE_MS = 5 * 60_000;

export function registerApiMonitoringConsumers(queue: Queue): void {
  queue.subscribe<unknown>(COMMANDS.apiMetricsIngest, async (msg) => {
    const parsed = ingestPayload.safeParse(msg.payload);
    if (!parsed.success) {
      log.warn({ messageId: msg.messageId, issues: parsed.error.issues.length }, "api metrics batch rejected: invalid payload");
      return;
    }
    const rows = parsed.data.rows.flatMap((r) => { const p = ingestRow.safeParse(r); return p.success ? [p.data] : []; });
    if (rows.length < parsed.data.rows.length) {
      log.warn({ messageId: msg.messageId, skipped: parsed.data.rows.length - rows.length }, "api metrics rows skipped: invalid or inconsistent");
    }
    const nowMs = Date.now();
    let pendingAdds: { day: string; keys: string[] } | null = null;
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const now = clock();
      const cache = await cachedSeen(tx, msg.tenantId, now);
      // Work on a copy: the cache only learns these endpoints once the transaction has committed.
      const seen = new Set(cache);
      const added: string[] = [];
      const cap = endpointCap();
      let foldedHere = 0;
      let reloaded = false;
      for (const r of rows) {
        const at = minuteStart(new Date(r.minute));
        if (at.getTime() < nowMs - MAX_AGE_MS || at.getTime() > nowMs + MAX_FUTURE_MS) continue;
        let service = r.service;
        let endpoint = r.endpoint;
        const key = repo.endpointKey(service, endpoint);
        if (!seen.has(key) && !(service === OTHER_SERVICE && endpoint === OTHER_ENDPOINT)) {
          if (seen.size < cap) { seen.add(key); added.push(key); }
          else {
            if (!reloaded) {
              // About to fold: refresh the day's set once (another process may have recorded endpoints this cache
              // has not seen), then decide this and every later row of the message against it.
              reloaded = true;
              seenQueries++;
              for (const k of await repo.endpointsSeenToday(tx, msg.tenantId, now)) if (!seen.has(k)) { seen.add(k); added.push(k); }
            }
            // Still unknown after the reload: genuinely new and over the cap. (Known after it: recorded elsewhere, keep it.)
            if (!seen.has(key)) { service = OTHER_SERVICE; endpoint = OTHER_ENDPOINT; foldedHere++; }
          }
        }
        await repo.addMinute(tx, msg.tenantId, {
          bucketMinute: at, service, endpoint, requests: r.requests,
          errors4xx: r.errors4xx, errors5xx: r.errors5xx, latencySumMs: r.sumMs, latencyBuckets: r.buckets,
        });
      }
      pendingAdds = { day: utcDay(now), keys: added };
      if (foldedHere > 0) {
        folded += foldedHere;
        log.warn({ tenantId: msg.tenantId, foldedRows: foldedHere, cap, foldedTotal: folded }, "api metrics: tenant over its daily endpoint cap, new endpoints folded into other");
      }
    }));
    // Committed: only now may the cache learn the endpoints this batch recorded.
    const adds = pendingAdds as { day: string; keys: string[] } | null;
    const c = dayCaches.get(msg.tenantId);
    if (adds && c && c.day === adds.day) for (const k of adds.keys) c.seen.add(k);
  });

  queue.subscribe<unknown>(COMMANDS.apiMetricsRetentionSet, async (msg) => {
    const parsed = retentionPayload.safeParse(msg.payload);
    if (!parsed.success) {
      log.warn({ messageId: msg.messageId }, "api metrics retention rejected: invalid payload");
      return;
    }
    const p = parsed.data;
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.upsertRetention(tx, msg.tenantId, p.retentionDays, msg.actorId);
      await auditEvent(tx, { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId },
        "update", "api_metrics_retention", msg.tenantId, { retentionDays: p.retentionDays });
    }));
  });
}

/** Hourly retention sweep (worker). Overlap-guarded; failures are logged, never thrown into the timer. */
export function startApiMetricsPurge(intervalMs = Number(process.env.API_METRICS_PURGE_MS ?? 3_600_000)): NodeJS.Timeout {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await repo.purgeExpired(new Date(), Number(process.env.API_METRICS_DEFAULT_RETENTION_DAYS ?? 30));
      if (r.deleted > 0) log.info(r, "api metrics: purged expired minutes");
    } catch (err) {
      log.error({ err }, "api metrics purge failed");
    } finally {
      running = false;
    }
  };
  void tick();
  const t = setInterval(() => void tick(), intervalMs);
  t.unref();
  return t;
}
