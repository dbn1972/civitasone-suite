/**
 * UAT owner decision #16 (GAP-KNOWLEDGE-ASSISTANT-06): assistant interactions are
 * retained 90 days, then purged. Audit events are deliberately NOT purged here;
 * they live in the audit trail and follow audit retention.
 */
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import { and, eq, inArray, lte } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { scannerDb } from "../../shared/scanner-db.js";
import { enqueue, type DrizzleTx } from "../../shared/outbox.js";
import { assistantInteractions } from "./schema.js";

export const ASSISTANT_RETENTION_DAYS = 90;
const AUDIT_TOPIC = "audit.event.record";
const SYSTEM_ACTOR = "00000000-0000-4000-8000-000000000000";
const BATCH = 1000;

const log = pino({ name: "knowledge.assistant-retention" });

/** expires_at for an interaction created at `from`. */
export function retentionExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + ASSISTANT_RETENTION_DAYS * 86_400_000);
}

/**
 * Delete interactions whose expires_at has passed. Tenants with expired rows are
 * discovered through the read-only scanner pool; each delete batch runs under that
 * tenant's GUC and writes its audit event (counts only, never question text) in the
 * SAME transaction. Returns the number of rows purged.
 */
export async function purgeExpiredInteractions(now: Date = new Date()): Promise<number> {
  const tenants = await scannerDb
    .selectDistinct({ tenantId: assistantInteractions.tenantId })
    .from(assistantInteractions)
    .where(lte(assistantInteractions.expiresAt, now));

  let total = 0;
  for (const { tenantId } of tenants) {
    for (;;) {
      const deleted = await runWithTenant(tenantId, () =>
        db.transaction(async (tx) => {
          const ids = tx.select({ id: assistantInteractions.id }).from(assistantInteractions)
            .where(and(eq(assistantInteractions.tenantId, tenantId), lte(assistantInteractions.expiresAt, now)))
            .limit(BATCH);
          const gone = await tx.delete(assistantInteractions)
            .where(and(eq(assistantInteractions.tenantId, tenantId), inArray(assistantInteractions.id, ids)))
            .returning({ id: assistantInteractions.id });
          if (gone.length > 0) {
            await enqueue(tx as unknown as DrizzleTx, {
              topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
              tenantId, actorId: SYSTEM_ACTOR, correlationId: randomUUID(),
              payload: {
                service: "knowledge", action: "purge", resourceType: "assistant_interaction",
                resourceId: randomUUID(), outcome: "success",
                count: gone.length, retentionDays: ASSISTANT_RETENTION_DAYS, cutoff: now.toISOString(),
              },
            });
          }
          return gone.length;
        }),
      );
      total += deleted;
      if (deleted < BATCH) break;
    }
  }
  if (total > 0) log.info({ total }, "purged expired assistant interactions");
  return total;
}

/** Start the periodic purge (hourly by default). Disabled with ASSISTANT_RETENTION_PURGE_ENABLED=false. */
export function startAssistantRetentionPurge(intervalMs = 60 * 60_000): ReturnType<typeof setInterval> | null {
  if (process.env.ASSISTANT_RETENTION_PURGE_ENABLED === "false") {
    log.info("assistant retention purge disabled (ASSISTANT_RETENTION_PURGE_ENABLED=false)");
    return null;
  }
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    purgeExpiredInteractions()
      .catch((err) => log.error({ err }, "assistant retention purge failed"))
      .finally(() => { running = false; });
  }, intervalMs);
  timer.unref();
  return timer;
}
