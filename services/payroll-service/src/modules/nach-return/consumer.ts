/**
 * NACH Return consumer — processes the return file records asynchronously.
 * Inserts records into nach_return_records table, emits events and audit trail.
 */
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { nachReturnRecords } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

interface NachReturnPayload {
  runId: string;
  records: Array<{
    reference: string;
    amountMinor: string;
    statusCode: string;
    reasonCode: string;
    reasonText: string;
  }>;
  summary: { credited: number; returned: number; unmatched: number };
}

export function registerNachReturnConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.nachReturnProcess, async (msg) => {
    const payload = msg.payload as NachReturnPayload;

    await db.transaction(async (tx) => {
      // Idempotency check
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Insert each record into nach_return_records
      for (const record of payload.records) {
        await tx.insert(nachReturnRecords).values({
          tenantId: msg.tenantId,
          runId: payload.runId,
          employeeNo: record.reference,
          statusCode: record.statusCode,
          reasonCode: record.reasonCode || null,
          reasonText: record.reasonText || null,
          amountMinor: BigInt(record.amountMinor),
          createdBy: msg.actorId,
        });
      }

      // Emit nach_return.processed event
      await enqueue(tx, {
        topic: EVENTS.nachReturnProcessed,
        eventType: EVENTS.nachReturnProcessed,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          runId: payload.runId,
          credited: payload.summary.credited,
          returned: payload.summary.returned,
          unmatched: payload.summary.unmatched,
          totalRecords: payload.records.length,
        },
      });

      // Emit audit event (no PII — only counts and amounts)
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "payroll",
          action: "nach_return_processed",
          resourceType: "payroll_run",
          resourceId: payload.runId,
          outcome: "success",
          detail: {
            credited: payload.summary.credited,
            returned: payload.summary.returned,
            unmatched: payload.summary.unmatched,
            totalRecords: payload.records.length,
          },
        },
      });
    });
  });
}
