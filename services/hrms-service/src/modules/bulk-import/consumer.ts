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
import type { BulkImportItem, BulkImportNotQueuedPayload, BulkImportRecordItem, BulkImportRecordPayload } from "./command.js";

const log = pino({ name: "hrms.bulk-import.consumer" });
const AUDIT = "audit.event.record";

/**
 * Record (a chunk of) a batch: markProcessed, the batch header + rows, and the audit event, in ONE transaction.
 * Resolves false when this command was already processed (a redelivery): the rows are already recorded, so the caller
 * must not record anything again -- it only re-drives the fan-out for rows that are still pending (see below).
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

/** The items of a redelivered record command whose rows are still pending (their create may never have been published). */
async function stillPending(tenantId: string, items: BulkImportRecordItem[]): Promise<BulkImportRecordItem[]> {
  const pending = await db.transaction((tx) => importRepo.pendingRowIds(tx, tenantId, items.map((i) => i.id)));
  return items.filter((i) => pending.has(i.id));
}

export function registerBulkImportConsumers(queue: Queue): void {
  // GAP-HR-EMPLOYEES-IMPORT-02. Handlers that touch the FORCE-RLS import tables run inside the message's tenant context.
  const scoped = tenantScoped(queue);

  // The route's accepted batch. The batch and its pending rows are committed BEFORE any create command exists, so the
  // create consumer always finds the row it marks 'created' / 'failed'; the batchId the caller got in the 202 is then a
  // real, pollable record.
  //
  // The fan-out is at-least-once. The record transaction and the publishes cannot share a transaction (the create
  // commands must carry the row id as their messageId, which the outbox does not allow), so a crash between the
  // commit and the end of the loop would leave rows 'pending' forever if a redelivery were a plain no-op. Instead a
  // REDELIVERED command (recordChunk resolves false) re-publishes the create command of every row of its chunk that
  // is still pending. That is safe: a create is idempotent (messageId == row id -> markProcessed in the create
  // consumer), and a row that was created or failed in the meantime is no longer pending, so it is not re-sent.
  scoped.subscribe(COMMANDS.employeeBulkImportRecord, async (msg) => {
    const p = msg.payload as BulkImportRecordPayload;
    const firstDelivery = await recordChunk(msg, p);
    const toSend: BulkImportRecordItem[] = firstDelivery ? p.items : await stillPending(msg.tenantId, p.items);
    if (toSend.length === 0) return;

    let queued = 0;
    try {
      for (const item of toSend) {
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
      // outcome is recorded on the rows themselves (failed, so a redelivery finds nothing pending to re-send).
      log.error({ err, batchId: p.batchId, queued, total: toSend.length, redelivery: !firstDelivery }, "bulk import: could not queue every create command");
      await db.transaction(async (tx) => {
        for (const { id } of toSend.slice(queued)) await importRepo.markRowFailed(tx, msg.tenantId, id, IMPORT_FAILURE.NOT_QUEUED);
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
