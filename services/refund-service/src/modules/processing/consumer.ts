import { pino } from "pino";
import { sql } from "drizzle-orm";
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
 * RACE-2: approve, reject, and return each publish to a DIFFERENT topic
 * (refund.approval.approve / .reject / .return), and per SqsQueue.start()
 * (services/queue-service/src/bus.ts) each topic runs its own independent,
 * unsynchronized poll loop — there is no ordering guarantee between them.
 * checkExpectedLevel's own "one poll loop per topic, race-free" reasoning
 * only holds WITHIN a single topic (e.g. two approve calls): it does NOT
 * cover two of these three DIFFERENT actions landing on the same request at
 * the same level, because insertApproval is a plain INSERT with nothing to
 * compare-and-swap against. Concretely: approve(level 1) and return(level 1)
 * both read maxApprovedLevel=0 before either commits, both compute
 * expectedLevel=1, both pass checkExpectedLevel. If return commits first,
 * approve's later INSERT still succeeds (it isn't blocked by anything) and
 * leaves a level-1 "approved" row that supersedeApprovals already ran
 * BEFORE it existed — a stale, never-superseded approval, i.e. a narrower
 * recurrence of the exact SEQ-1 bug this file's return-for-correction fix
 * targets, just triggered by a race instead of plain sequential misuse.
 *
 * A Postgres session-level advisory lock scoped to the transaction
 * (pg_advisory_xact_lock, auto-released on commit OR rollback) closes this
 * regardless of which topic each action is on: whichever of approve/reject/
 * return acquires the lock for this requestId first runs its ENTIRE
 * check-then-insert sequence to completion (commit or rollback) before any
 * of the other two can even begin theirs, because they block on the same
 * lock key until it's released. hashtext() folds the uuid string into the
 * bigint key pg_advisory_xact_lock expects.
 */
async function lockRequestForApprovalDecision(tx: ScopedTx, requestId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`);
}

/**
 * SEQ-2 (TOCTOU, within one topic): re-verifies the expected level inside
 * the same transaction as the write, immediately before it — see
 * lockRequestForApprovalDecision above for the CROSS-topic race this alone
 * does not cover, which is why every caller takes both.
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
    const changed = await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return false;
      // RACE-1: review is a no-op-ish re-affirmation, valid from either
      // requested or under_review (matches the route's own pre-check), but
      // must not silently succeed once a racing action has moved the
      // request somewhere else (e.g. rejected/withdrawn/approved).
      const ok = await reqRepo.updateStatus(tx, p.requestId, msg.tenantId, "under_review", msg.actorId, ["requested", "under_review"]);
      if (!ok) return false;
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
      await lockRequestForApprovalDecision(tx, p.requestId);
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
        // RACE-1: fully approving is only valid from under_review — must not
        // overwrite a racing reject/withdraw that already moved it away.
        const ok = await reqRepo.updateStatus(tx, p.requestId, msg.tenantId, "approved", msg.actorId, ["under_review"]);
        if (!ok) {
          log.warn(
            { requestId: p.requestId, level: p.level },
            "approval recorded but request status unchanged: a concurrent action already moved it out of under_review",
          );
          return false;
        }
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
      await lockRequestForApprovalDecision(tx, p.requestId);
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
      // RACE-1: reject is only valid from under_review — must not overwrite
      // a racing approve that already fully approved it (trace (a)).
      const ok = await reqRepo.updateStatus(tx, p.requestId, msg.tenantId, "rejected", msg.actorId, ["under_review"]);
      if (!ok) {
        log.warn({ requestId: p.requestId }, "rejection recorded but request status unchanged: a concurrent action already moved it out of under_review");
        return false;
      }
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
      await lockRequestForApprovalDecision(tx, p.requestId);
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
      // RACE-1: return is only valid from under_review.
      const ok = await reqRepo.updateStatus(tx, p.requestId, msg.tenantId, "requested", msg.actorId, ["under_review"]);
      if (!ok) {
        log.warn({ requestId: p.requestId }, "return recorded but request status unchanged: a concurrent action already moved it out of under_review");
        return false;
      }
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
