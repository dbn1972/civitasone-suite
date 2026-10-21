import { pino } from "pino";
import type { CommandEnvelope, Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS } from "../../topics.js";
import { emitAudit } from "../recruitment/audit-emit.js";
import * as importRepo from "./repo.js";
import { IMPORT_FAILURE, type ImportFailureCode } from "./failure.js";
import type { BulkImportItem, BulkImportNotQueuedPayload, BulkImportRecordPayload } from "./command.js";

const log = pino({ name: "hrms.bulk-import.consumer" });
const AUDIT = "audit.event.record";

/**
 * Record (a chunk of) a batch: markProcessed, the batch header + rows, and the audit event, in ONE transaction.
 * Resolves false when this command was already processed (a redelivery): the rows are recorded and the fan-out was
 * already attempted the first time, so the caller must not publish anything again.
 */
async function recordChunk(
  msg: CommandEnvelope,
  p: { batchId: string; total: number; items: BulkImportItem[] },
  failedWith?: ImportFailureCode,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return false;
    const createdHeader = await importRepo.insertBatch(tx, {
      id: p.batchId, tenantId: msg.tenantId, requestedBy: msg.actorId, correlationId: msg.correlationId ?? null, total: p.total,
      rows: p.items.map((i) => ({ messageId: i.id, rowNo: i.rowNo, employeeNo: i.employeeNo })),
      ...(failedWith ? { failedWith } : {}),
    });
    // Once per batch, by whichever chunk created the header (chunks may be consumed in any order / in parallel).
    if (createdHeader) {
      await emitAudit(tx, { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId },
        "hrms.employee.bulk_import_requested", "employee_import_batch", p.batchId, { total: p.total });
    }
    return true;
  });
}

export function registerBulkImportConsumers(queue: Queue): void {
  // GAP-HR-EMPLOYEES-IMPORT-02. Handlers that touch the FORCE-RLS import tables run inside the message's tenant context.
  const scoped = tenantScoped(queue);

  // The route's accepted batch. The batch and its pending rows are committed BEFORE any create command exists, so the
  // create consumer always finds the row it marks 'created' / 'failed'; the batchId the caller got in the 202 is then a
  // real, pollable record.
  scoped.subscribe(COMMANDS.employeeBulkImportRecord, async (msg) => {
    const p = msg.payload as BulkImportRecordPayload;
    if (!(await recordChunk(msg, p))) return;

    let queued = 0;
    try {
      for (const item of p.items) {
        await queue.publish(COMMANDS.employeeCreate, {
          messageId: item.id, type: COMMANDS.employeeCreate,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, schemaVersion: "1.0",
          payload: item.create,
        });
        queued++;
      }
    } catch (err) {
      // The queue broke part-way. Rows never handed to it will never be processed: mark them failed so the batch can
      // finish instead of reading "processing" forever. The row whose publish threw is included -- if it was in fact
      // delivered, the create consumer's markRowCreated still wins (created overrides failed). Not rethrown: the
      // command is already marked processed, so a redelivery would be a no-op; the outcome is on the rows.
      log.error({ err, batchId: p.batchId, queued, total: p.items.length }, "bulk import: could not queue every create command");
      await db.transaction(async (tx) => {
        for (const { id } of p.items.slice(queued)) await importRepo.markRowFailed(tx, msg.tenantId, id, IMPORT_FAILURE.NOT_QUEUED);
      });
    }
  });

  // The route could not publish every record command: the rows of the unsent ones are recorded straight to 'failed'.
  // A no-op for any row a record command did record (those are being created, or already failed on their own).
  scoped.subscribe(COMMANDS.employeeBulkImportNotQueued, async (msg) => {
    await recordChunk(msg, msg.payload as BulkImportNotQueuedPayload, IMPORT_FAILURE.NOT_QUEUED);
  });

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
    await cache.invalidateResource(msg.tenantId, "bulk_import");
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
    await cache.invalidateResource(msg.tenantId, "bulk_import");
    log.info({ id: msg.messageId, batchId: p.batchId }, "Processed bulk_import.complete");
  });
}
