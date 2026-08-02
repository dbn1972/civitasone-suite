import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { SyncOperation } from "./domain.js";

const log = pino({ name: "field.sync.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerSyncConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.syncPush, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; operations: SyncOperation[] };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const rows = p.operations.map((op) => ({
        id: op.id,
        tenantId: msg.tenantId,
        agentId: msg.actorId,
        entityType: op.entityType,
        entityId: op.entityId,
        operation: op.operation,
        payload: op.payload,
        clientTimestamp: new Date(op.clientTimestamp),
        clientVersion: op.clientVersion,
        status: "pending" as const,
      }));

      await repo.insertBatch(tx, rows);

      await enqueue(tx, {
        topic: EVENTS.syncCompleted,
        eventType: EVENTS.syncCompleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { operationCount: p.operations.length, agentId: msg.actorId, batchId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "sync.push",
        resourceType: "field_sync_batch",
        resourceId: p.id,
        details: { operationCount: p.operations.length },
      });
    });
    log.info({ id: p.id, count: p.operations.length }, "sync batch processed");
  });
}
