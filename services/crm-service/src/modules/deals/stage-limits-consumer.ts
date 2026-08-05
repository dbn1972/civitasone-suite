/**
 * Stage-limit consumer (OP-005) — applies crm.stage_limit.upsert / delete.
 * Upsert keys on (tenant, COALESCE(pipeline_id, sentinel), stage) to match the unique
 * index, so re-configuring a stage'\''s limit updates the row rather than duplicating it.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const log = pino({ name: "crm-stage-limit-consumer" });
const RESOURCE = "stage_limit";
const SENTINEL = "00000000-0000-0000-0000-000000000000";

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId } as Parameters<typeof emitWithAudit>[1];
}

export function registerStageLimitConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.upsertStageLimit, async (msg) => {
    const p = msg.payload as { tenantId: string; pipelineId: string | null; stage: string; maxDays: number; enabled: boolean };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          INSERT INTO crm.stage_limits (tenant_id, pipeline_id, stage, max_days, enabled, created_by, updated_by)
          VALUES (${p.tenantId}, ${p.pipelineId}, ${p.stage}, ${p.maxDays}, ${p.enabled}, ${msg.actorId}, ${msg.actorId})
          ON CONFLICT (tenant_id, COALESCE(pipeline_id, ${SENTINEL}::uuid), stage) DO UPDATE
            SET max_days = EXCLUDED.max_days, enabled = EXCLUDED.enabled,
                updated_at = now(), updated_by = EXCLUDED.updated_by, version = crm.stage_limits.version + 1
        `);
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.stageLimitUpserted,
          action: "upsert",
          resourceType: RESOURCE,
          resourceId: `${p.pipelineId ?? "default"}:${p.stage}`,
          payload: { stage: p.stage, pipelineId: p.pipelineId, maxDays: p.maxDays, enabled: p.enabled },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "upsertStageLimit failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.deleteStageLimit, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          DELETE FROM crm.stage_limits WHERE id = ${p.id} AND tenant_id = ${p.tenantId}
        `);
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.stageLimitDeleted,
          action: "delete",
          resourceType: RESOURCE,
          resourceId: p.id,
          payload: { id: p.id },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "deleteStageLimit failed");
      throw err;
    }
  });
}
