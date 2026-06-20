import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerBackupConsumers(queue: Queue): void {
  queue.subscribe<{ tenantId: string; cronExpr: string }>(COMMANDS.backupSchedule, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.upsertSchedule(tx, msg.payload.tenantId, msg.payload.cronExpr, msg.actorId);
      await audit(tx, msg, "backup_schedule", msg.payload.tenantId);
    });
    await cache.invalidate(cache.makeKey(msg.payload.tenantId, "backup_runs", msg.payload.tenantId));
  });

  queue.subscribe<{ tenantId: string; runId: string }>(COMMANDS.backupTrigger, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRun(tx, {
        id: msg.payload.runId, tenantId: msg.payload.tenantId, status: "running",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "backup_trigger", msg.payload.runId);
    });
    await cache.invalidate(cache.makeKey(msg.payload.tenantId, "backup_runs", msg.payload.tenantId));
  });
}

async function audit(tx: unknown, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceId: string): Promise<void> {
  const t = tx as any;
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "admin", action, resourceType: "backup", resourceId, outcome: "success" },
  });
}
