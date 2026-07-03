import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "hrms.bulk-import.consumer" });
const AUDIT = "audit.event.record";

export function registerBulkImportConsumers(queue: Queue): void {
  queue.subscribe("hrms.bulk_import.start", async (msg) => {
    const p = msg.payload as {
      batchId: string; tenantId: string;
      totalRows: number; source: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.bulk_import.started",
        eventType: "hrms.bulk_import.started",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { batchId: p.batchId, totalRows: p.totalRows, source: p.source },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "bulk_import_start", resourceType: "bulk_import", resourceId: p.batchId, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:bulk_import:*`);
    log.info({ id: msg.messageId, batchId: p.batchId }, "Processed bulk_import.start");
  });

  queue.subscribe("hrms.bulk_import.complete", async (msg) => {
    const p = msg.payload as {
      batchId: string; tenantId: string;
      successCount: number; failureCount: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.bulk_import.completed",
        eventType: "hrms.bulk_import.completed",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { batchId: p.batchId, successCount: p.successCount, failureCount: p.failureCount },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "bulk_import_complete", resourceType: "bulk_import", resourceId: p.batchId, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:bulk_import:*`);
    log.info({ id: msg.messageId, batchId: p.batchId }, "Processed bulk_import.complete");
  });
}
