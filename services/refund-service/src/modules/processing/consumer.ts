import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db, type ScopedTx, lockForStatusChange, RaceLost, transactionOrRaceLost } from "../../shared/db.js";
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
 * compare-and-swap against. lockForStatusChange (shared/db.ts) closes this
 * regardless of which topic each action is on: whichever of approve/reject/
 * return acquires the lock for this requestId first runs its ENTIRE
 * check-then-write sequence to completion (commit or rollback) before any
 * of the other two can even begin theirs.
 *
 * withdrawRequest (requests/consumer.ts) also acquires this same lock, so
 * approve/reject/return are serialized against withdraw too, not just
 * against each other — see that file for why, and shared/db.ts's RaceLost
 * doc comment for the specific bug (approved-decision-silently-committed
 * despite a losing status guard) this pairing was live-reproduced to close.
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
    // No RaceLost needed here: updateStatus is the only write in this
    // transaction, and it's the FIRST thing checked -- nothing has been
    // committed yet if it fails, so a plain `return false` is safe (an
    // empty/no-op transaction, aside from markProcessed's own row, which we
    // WANT to keep so a redelivery of this exact message doesn't reprocess).
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
    // RACE-3: insertApproval below happens BEFORE the isFullyApproved
    // status guard, so a plain `return false` there would leave the just-
    // inserted approval row committed even when the guard says the overall
    // action lost its race — transactionOrRaceLost + throwing RaceLost
    // instead makes the whole transaction roll back atomically.
    const changed = await transactionOrRaceLost(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return false;
      await lockForStatusChange(tx, p.requestId);
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
            "approval lost the race: a concurrent action already moved the request out of under_review — rolling back this approval entirely",
          );
          throw new RaceLost();
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
    // RACE-3: see approveRequest above — insertApproval happens before the
    // status guard here too.
    const changed = await transactionOrRaceLost(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return false;
      await lockForStatusChange(tx, p.requestId);
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
      // a racing approve that already fully approved it.
      const ok = await reqRepo.updateStatus(tx, p.requestId, msg.tenantId, "rejected", msg.actorId, ["under_review"]);
      if (!ok) {
        log.warn(
          { requestId: p.requestId },
          "rejection lost the race: a concurrent action already moved the request out of under_review — rolling back this rejection entirely",
        );
        throw new RaceLost();
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
    // RACE-3: this is the exact trace live-reproduced against withdraw —
    // insertApproval + supersedeApprovals both ran before the status guard,
    // so a lost race here used to leave a phantom "returned" decision and an
    // incorrectly-superseded real approval permanently on record even
    // though the request was never actually returned (withdraw won
    // instead). throw + transactionOrRaceLost rolls back all of it.
    const changed = await transactionOrRaceLost(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return false;
      await lockForStatusChange(tx, p.requestId);
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
        log.warn(
          { requestId: p.requestId },
          "return lost the race: a concurrent action already moved the request out of under_review — rolling back this return (and the approval it would have superseded) entirely",
        );
        throw new RaceLost();
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
