/**
 * NACH Return consumer — processes the return file records asynchronously.
 * Inserts records into nach_return_records table, emits events and audit trail.
 */
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { nachReturnFiles, nachReturnRecords } from "./schema.js";
import { applyNachReturnToTransfers } from "../disbursement-transfers/ledger.js";

const AUDIT_TOPIC = "audit.event.record";

interface NachReturnPayload {
  runId: string;
  /** sha256 of the normalised file content (absent on messages queued before 0053). */
  fileHash?: string;
  /** The issued NACH file this return answers; null when the run has no NACH ledger rows. */
  fileReference?: string | null;
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

      // Review D4: the same return file is applied at most once per run, even
      // under a different messageId -- a stale re-upload must never settle a
      // later retry of the same employee.
      if (payload.fileHash) {
        const fresh = await tx.insert(nachReturnFiles).values({
          tenantId: msg.tenantId,
          runId: payload.runId,
          fileHash: payload.fileHash,
          fileReference: payload.fileReference ?? null,
          messageId: msg.messageId,
          createdBy: msg.actorId,
        }).onConflictDoNothing().returning({ id: nachReturnFiles.id });
        if (fresh.length === 0) {
          await enqueue(tx, {
            topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
            tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: {
              service: "payroll", action: "nach_return_duplicate_ignored", resourceType: "payroll_run",
              resourceId: payload.runId, outcome: "failure",
              detail: { fileHash: payload.fileHash, fileReference: payload.fileReference ?? null },
            },
          });
          return;
        }
      }

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

      // GAP-PAYROLL-DISBURSEMENT-TRANSFERS: settle the matching NACH rows of
      // the transfer ledger (same transaction as the records + audit below).
      const ledger = await applyNachReturnToTransfers(tx, {
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        runId: payload.runId,
        fileReference: payload.fileReference ?? null,
        records: payload.records.map((r) => ({
          reference: r.reference,
          amountMinor: BigInt(r.amountMinor),
          statusCode: r.statusCode,
          reasonCode: r.reasonCode,
          reasonText: r.reasonText,
        })),
      });

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
            fileReference: payload.fileReference ?? null,
            ledger: { ...ledger, reversals: ledger.reversals.length, duplicateCredits: ledger.duplicateCredits.length },
          },
        },
      });

      // The bank credited an attempt that already has a newer one (e.g. after
      // a full re-issue): the employee may have been paid twice.
      for (const dc of ledger.duplicateCredits) {
        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            service: "payroll", action: "disbursement_transfer_duplicate_credit_detected",
            resourceType: "disbursement_transfer", resourceId: dc.transferId, outcome: "success",
            detail: {
              runId: payload.runId, transferId: dc.transferId, childTransferId: dc.childTransferId,
              fileReference: dc.fileReference, amountMinor: dc.amountMinor, requiresReview: true,
            },
          },
        });
      }

      // A credit the bank now reports as returned/failed: money we recorded
      // as paid did not land. Each one gets its own audit row for review.
      for (const rv of ledger.reversals) {
        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            service: "payroll", action: "disbursement_transfer_settlement_reversed",
            resourceType: "disbursement_transfer", resourceId: rv.transferId, outcome: "success",
            detail: {
              runId: payload.runId, fileReference: payload.fileReference ?? null,
              fromStatus: rv.fromStatus, toStatus: rv.toStatus, reasonCode: rv.reasonCode,
              amountMinor: rv.amountMinor, requiresReview: true,
            },
          },
        });
      }
    });
  });
}
