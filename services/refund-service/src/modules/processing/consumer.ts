import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db, type ScopedTx } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { invalidateCacheSafely } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as reqRepo from "../requests/repo.js";
import { isFullyApproved, getNextApprovalLevel } from "./domain.js";

const log = pino({ name: "refund.processing.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

/**
 * SEQ-2 (TOCTOU): processing/routes.ts already checks this via
 * assertNextApprovalLevel, but only as a SELECT at request time — the actual
 * write happens later, asynchronously, in this consumer. Two approve/reject/
 * return calls at the same level, submitted close enough together that both
 * pass the route-level check before either command is consumed, would
 * otherwise both be applied here with nothing to stop them (no re-check, no
 * DB uniqueness on (request, level, "approved") until this same PR's
 * migration 0002). This re-verifies the expected level inside the same
 * transaction as the write, immediately before it, mirroring the
 * findActiveByRequestTx pattern already used in reconciliation/consumer.ts
 * for the double-disbursement guard. Message processing for a single topic
 * is strictly sequential in this service (one worker instance, one poll
 * loop per topic — see SqsQueue.pollTopic), so a check-then-write inside one
 * transaction is race-free for the current deployment topology; a stale/
 * duplicate action is logged and skipped rather than silently re-applied.
 * Live-verified: two concurrent level-1 approve calls for the same request
 * both return 202, but exactly one "approved" row is inserted and the
 * other is logged as "stale approval-sequence action ignored".
 */
async function checkExpectedLevel(
  requestId: string,
  tenantId: string,
  level: number,
  tx: ScopedTx,
): Promise<boolean> {
  const maxApprovedLevel = await repo.getMaxApprovalLevelTx(tx, requestId, tenantId);
  const expectedLevel = getNextApprovalLevel(maxApprovedLevel);
  if (expectedLevel === null || level !== expectedLevel) {
    log.warn(
      { requestId, attemptedLevel: level, expectedLevel },
      "stale approval-sequence action ignored: a concurrent action already changed the expected level",
    );
    return false;
  }
  return true;
}

export function registerProcessingConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.reviewRequest, async (msg) => {
    const p = msg.payload as { requestId: string; tenantId: string };
    // CACHE-2: no cache call inside the transaction — see
    // shared/infra.ts's invalidateCacheSafely doc comment.
    const changed = await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return false;
      await reqRepo.updateStatus(tx, p.requestId, msg.tenantId, "under_review", msg.actorId);
      await enqueue(tx, {
        topic: EVENTS.requestReviewed,
        eventType: EVENTS.requestReviewed,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { requestId: p.requestId },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "request.review",
        resourceType: "refund_request",
        resourceId: p.requestId,
      });
      return true;
    });
    if (changed) {
      await invalidateCacheSafely(reqRepo.cacheKey(msg.tenantId, p.requestId), log);
    }
  });

  queue.subscribe(COMMANDS.approveRequest, async (msg) => {
    const p = msg.payload as {
      id: string;
      requestId: string;
      tenantId: string;
      level: number;
      remarks?: string;
    };
    const changed = await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return false;
      if (!(await checkExpectedLevel(p.requestId, msg.tenantId, p.level, tx))) return false;

      await repo.insertApproval(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        requestId: p.requestId,
        approvalLevel: p.level,
        approverId: msg.actorId,
        decision: "approved",
        remarks: p.remarks ?? null,
        decidedAt: new Date(),
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      if (isFullyApproved(p.level)) {
        await reqRepo.updateStatus(tx, p.requestId, msg.tenantId, "approved", msg.actorId);
      }
      await enqueue(tx, {
        topic: EVENTS.requestApproved,
        eventType: EVENTS.requestApproved,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          approvalId: p.id,
          requestId: p.requestId,
          level: p.level,
          fullyApproved: isFullyApproved(p.level),
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "request.approve",
        resourceType: "refund_approval",
        resourceId: p.id,
      });
      return true;
    });
    if (changed) {
      await invalidateCacheSafely(reqRepo.cacheKey(msg.tenantId, p.requestId), log);
      log.info({ id: p.id, requestId: p.requestId, level: p.level }, "approval recorded");
    }
  });

  queue.subscribe(COMMANDS.rejectRequest, async (msg) => {
    const p = msg.payload as {
      id: string;
      requestId: string;
      tenantId: string;
      level: number;
      remarks: string;
    };
    const changed = await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return false;
      if (!(await checkExpectedLevel(p.requestId, msg.tenantId, p.level, tx))) return false;

      await repo.insertApproval(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        requestId: p.requestId,
        approvalLevel: p.level,
        approverId: msg.actorId,
        decision: "rejected",
        remarks: p.remarks,
        decidedAt: new Date(),
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await reqRepo.updateStatus(tx, p.requestId, msg.tenantId, "rejected", msg.actorId);
      await enqueue(tx, {
        topic: EVENTS.requestRejected,
        eventType: EVENTS.requestRejected,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { approvalId: p.id, requestId: p.requestId, remarks: p.remarks },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "request.reject",
        resourceType: "refund_approval",
        resourceId: p.id,
      });
      return true;
    });
    if (changed) {
      await invalidateCacheSafely(reqRepo.cacheKey(msg.tenantId, p.requestId), log);
    }
  });

  queue.subscribe(COMMANDS.returnRequest, async (msg) => {
    const p = msg.payload as {
      id: string;
      requestId: string;
      tenantId: string;
      level: number;
      remarks: string;
    };
    const changed = await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return false;
      if (!(await checkExpectedLevel(p.requestId, msg.tenantId, p.level, tx))) return false;

      await repo.insertApproval(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        requestId: p.requestId,
        approvalLevel: p.level,
        approverId: msg.actorId,
        decision: "returned",
        remarks: p.remarks,
        decidedAt: new Date(),
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      // SEQ-1: start the next review round clean — see repo.supersedeApprovals.
      await repo.supersedeApprovals(tx, p.requestId, msg.tenantId, msg.actorId);
      await reqRepo.updateStatus(tx, p.requestId, msg.tenantId, "requested", msg.actorId);
      await enqueue(tx, {
        topic: EVENTS.requestReturned,
        eventType: EVENTS.requestReturned,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { approvalId: p.id, requestId: p.requestId, remarks: p.remarks },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "request.return",
        resourceType: "refund_approval",
        resourceId: p.id,
      });
      return true;
    });
    if (changed) {
      await invalidateCacheSafely(reqRepo.cacheKey(msg.tenantId, p.requestId), log);
    }
  });
}
