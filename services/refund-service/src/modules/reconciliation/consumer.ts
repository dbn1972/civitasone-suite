import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as reqRepo from "../requests/repo.js";

const log = pino({ name: "refund.reconciliation.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerReconciliationConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.initiateDisbursement, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      requestId: string;
      bankAccountDetails: { accountNumber: string; ifscCode: string; accountHolderName: string; bankName?: string };
      disbursedAmountMinor: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertDisbursement(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        requestId: p.requestId,
        bankAccountDetails: p.bankAccountDetails,
        disbursementRef: null,
        disbursedAmountMinor: BigInt(p.disbursedAmountMinor),
        status: "initiated",
        currency: "INR",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await reqRepo.updateStatus(tx, p.requestId, msg.tenantId, "processing", msg.actorId);
      await enqueue(tx, {
        topic: EVENTS.disbursementInitiated,
        eventType: EVENTS.disbursementInitiated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          disbursementId: p.id,
          requestId: p.requestId,
          disbursedAmountMinor: p.disbursedAmountMinor,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "disbursement.initiate",
        resourceType: "refund_disbursement",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, requestId: p.requestId }, "disbursement initiated");
  });

  queue.subscribe(COMMANDS.completeDisbursement, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; disbursementRef: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateStatus(tx, p.id, msg.tenantId, "completed", msg.actorId);
      const disb = await repo.findById(p.id, msg.tenantId);
      if (disb) {
        await reqRepo.updateStatus(tx, disb.requestId, msg.tenantId, "refunded", msg.actorId);
      }
      await enqueue(tx, {
        topic: EVENTS.disbursementCompleted,
        eventType: EVENTS.disbursementCompleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { disbursementId: p.id, disbursementRef: p.disbursementRef },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "disbursement.complete",
        resourceType: "refund_disbursement",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id }, "disbursement completed");
  });

  queue.subscribe(COMMANDS.failDisbursement, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.markFailed(tx, p.id, msg.tenantId, p.reason, msg.actorId);
      const disb = await repo.findById(p.id, msg.tenantId);
      if (disb) {
        await reqRepo.updateStatus(tx, disb.requestId, msg.tenantId, "failed", msg.actorId);
      }
      await enqueue(tx, {
        topic: EVENTS.disbursementFailed,
        eventType: EVENTS.disbursementFailed,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { disbursementId: p.id, reason: p.reason },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "disbursement.fail",
        resourceType: "refund_disbursement",
        resourceId: p.id,
      });
    });
  });

  queue.subscribe(COMMANDS.reconcile, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.reconcile(tx, p.id, msg.tenantId, msg.actorId);
      await enqueue(tx, {
        topic: EVENTS.reconciled,
        eventType: EVENTS.reconciled,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { disbursementId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "disbursement.reconcile",
        resourceType: "refund_disbursement",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id }, "disbursement reconciled");
  });
}
