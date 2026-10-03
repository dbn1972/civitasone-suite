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
export const ingestPayload = z.object({
  rows: z.array(z.object({
    minute: z.string().datetime(),
    service: z.string().min(1).max(64),
    endpoint: z.string().min(1).max(200),
    requests: count.min(1),
    errors4xx: count,
    errors5xx: count,
    sumMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    buckets: z.array(count).length(LATENCY_BUCKET_COUNT),
  })).max(2000),
});

const retentionPayload = z.object({
  id: z.string().uuid(),
  retentionDays: z.number().int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS),
});

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
    const nowMs = Date.now();
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      for (const r of parsed.data.rows) {
        const at = minuteStart(new Date(r.minute));
        if (at.getTime() < nowMs - MAX_AGE_MS || at.getTime() > nowMs + MAX_FUTURE_MS) continue;
        await repo.addMinute(tx, msg.tenantId, {
          bucketMinute: at, service: r.service, endpoint: r.endpoint, requests: r.requests,
          errors4xx: r.errors4xx, errors5xx: r.errors5xx, latencySumMs: r.sumMs, latencyBuckets: r.buckets,
        });
      }
    }));
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
