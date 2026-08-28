import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { invalidateCacheSafely } from "../../shared/infra.js";
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
    const inserted = await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return false;

      // FIN-3 / double-disbursement guard, defense in depth: routes.ts already
      // refuses a second active disbursement, but this re-checks inside the
      // same transaction immediately before inserting so this consumer never
      // creates a duplicate even if two initiate commands were both accepted.
      // Only "initiateDisbursement" ever inserts a disbursement row, so
      // unlike RACE-2's approve/reject/return, this really is a single-topic
      // race and the tx-scoped re-check alone is race-free here.
      const existingActive = await repo.findActiveByRequestTx(tx, p.requestId, msg.tenantId);
      if (existingActive) {
        log.warn(
          { requestId: p.requestId, attemptedDisbursementId: p.id, existingDisbursementId: existingActive.id },
          "duplicate disbursement initiation ignored: an active disbursement already exists for this request",
        );
        return false;
      }

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
      // RACE-1: initiating a disbursement is only valid from approved or
      // failed (retry) — matches reconciliation/routes.ts's own guard.
      const ok = await reqRepo.updateStatus(tx, p.requestId, msg.tenantId, "processing", msg.actorId, ["approved", "failed"]);
      if (!ok) {
        log.warn({ requestId: p.requestId }, "disbursement inserted but request status unchanged: a concurrent action already moved it out of approved/failed");
        return false;
      }
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
      return true;
    });
    if (inserted) {
      await invalidateCacheSafely(reqRepo.cacheKey(msg.tenantId, p.requestId), log);
      log.info({ id: p.id, requestId: p.requestId }, "disbursement initiated");
    }
  });

  queue.subscribe(COMMANDS.completeDisbursement, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; disbursementRef: string };
    let requestId: string | null = null;
    const completed = await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return false;
      // RACE-1 (THE SEVERE ONE): completeDisbursement and failDisbursement
      // publish to two DIFFERENT topics with no ordering between their poll
      // loops. Without this precondition, a fail racing in after a complete
      // had already sent real money would flip the SAME row to "failed" --
      // and since findActiveByRequest/migration 0002's unique index both key
      // off status <> 'failed', and initiateDisbursement treats "failed" as
      // retryable, that reopens this exact request for a brand new, real
      // second disbursement: a genuine double payout. Requiring the row to
      // still be initiated/processing makes this atomic: whichever of
      // complete/fail commits first wins, and the other's UPDATE matches
      // zero rows.
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "completed", msg.actorId, ["initiated", "processing"]);
      if (!ok) {
        log.warn({ id: p.id }, "duplicate/stale disbursement completion ignored: disbursement is no longer initiated/processing");
        return false;
      }
      const disb = await repo.findByIdTx(tx, p.id, msg.tenantId);
      if (disb) {
        // RACE-1: completing a disbursement moves the request from
        // "processing" to "refunded" -- guarded the same way.
        await reqRepo.updateStatus(tx, disb.requestId, msg.tenantId, "refunded", msg.actorId, ["processing"]);
        requestId = disb.requestId;
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
      return true;
    });
    if (requestId) {
      await invalidateCacheSafely(reqRepo.cacheKey(msg.tenantId, requestId), log);
    }
    if (completed) {
      log.info({ id: p.id }, "disbursement completed");
    }
  });

  queue.subscribe(COMMANDS.failDisbursement, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string };
    let requestId: string | null = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // RACE-1 (THE SEVERE ONE): see completeDisbursement above -- the same
      // guard, symmetrically. If complete already committed, this correctly
      // no-ops instead of flipping an already-paid disbursement to "failed".
      const ok = await repo.markFailed(tx, p.id, msg.tenantId, p.reason, msg.actorId, ["initiated", "processing"]);
      if (!ok) {
        log.warn({ id: p.id }, "duplicate/stale disbursement failure ignored: disbursement is no longer initiated/processing");
        return;
      }
      const disb = await repo.findByIdTx(tx, p.id, msg.tenantId);
      if (disb) {
        // RACE-1: failing a disbursement moves the request from "processing"
        // to "failed" -- guarded the same way.
        await reqRepo.updateStatus(tx, disb.requestId, msg.tenantId, "failed", msg.actorId, ["processing"]);
        requestId = disb.requestId;
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
    if (requestId) {
      await invalidateCacheSafely(reqRepo.cacheKey(msg.tenantId, requestId), log);
    }
  });

  queue.subscribe(COMMANDS.reconcile, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    const reconciled = await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return false;
      // FIN-5 / TOCTOU: repo.reconcile's WHERE clause re-asserts
      // reconciled_at IS NULL, so a second (concurrent or redelivered) call
      // for an already-reconciled disbursement returns false here instead
      // of silently overwriting reconciledAt/reconciledBy a second time.
      const ok = await repo.reconcile(tx, p.id, msg.tenantId, msg.actorId);
      if (!ok) {
        log.warn({ id: p.id }, "duplicate reconcile ignored: disbursement was already reconciled");
        return false;
      }
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
      return true;
    });
    if (reconciled) {
      log.info({ id: p.id }, "disbursement reconciled");
    }
  });
}
