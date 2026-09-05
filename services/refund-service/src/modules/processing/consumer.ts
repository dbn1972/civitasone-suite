import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db, type ScopedTx, lockForStatusChange, RaceLost, transactionOrRaceLost } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { invalidateCacheSafely } from "../../shared/infra.js";
import {
  emitMunicipalNotification,
  municipalDecisionNotificationEventType,
  MUNICIPAL_EVENT_TYPES,
} from "../../shared/cross-events.js";
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
 * lockForStatusChange (shared/db.ts) closes this regardless of which topic
 * each action is on: whichever of approve/reject/return (and withdraw —
 * see requests/consumer.ts, which acquires the identical lock) acquires the
 * lock for this requestId first runs its ENTIRE check-then-write sequence
 * to completion (commit or rollback) before any of the others can even
 * begin theirs.
 *
 * FIN-6 (deterministic, NOT a race): assertActionable below checks BOTH the
 * approval-level sequence AND the request's current status, unconditionally,
 * for all three actions alike. Before this fix, approveRequest only checked
 * request status inside `if (isFullyApproved(level))` — true only at level 2
 * in this 2-level scheme — so a level-1 approve had NO status check at all,
 * not "vulnerable to a race", just flatly missing: submit -> approve(level
 * 1) -> [ordinary, sequential, no timing needed] withdraw left a permanent
 * "approved" decision on record for a request whose canonical status was
 * "withdrawn". Conflating "is this the next expected level" (a question
 * about refund_approvals, checkExpectedLevel's job) with "is the request
 * still approvable at all" (a question about refund_requests.status) inside
 * one level-gated branch is exactly what let this hide through three prior
 * review rounds that each fixed a different bug in this same file. The fix
 * makes status-actionability a single, unconditional, un-branched check
 * every action performs identically, so there is no longer a code path
 * that can skip it depending on which level or which of approve/reject/
 * return is being handled.
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

/**
 * FIN-6: the single, unconditional precondition every approval-decision
 * action (approve at ANY level, reject, return) must pass before it writes
 * anything at all — see the doc comment above checkExpectedLevel for why
 * this needs to be its own explicit, always-called check rather than
 * something that happens to occur inside one particular branch.
 */
async function assertActionable(
  requestId: string,
  tenantId: string,
  level: number,
  tx: ScopedTx,
): Promise<boolean> {
  if (!(await checkExpectedLevel(requestId, tenantId, level, tx))) return false;
  const request = await reqRepo.findByIdTx(tx, requestId, tenantId);
  if (!request || request.status !== "under_review") {
    log.warn(
      { requestId, actualStatus: request?.status ?? "not found" },
      "approval-decision action ignored: request is no longer under_review",
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
    // committed yet if it fails, so a plain `return false` is safe.
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
    // RACE-3: insertApproval below happens BEFORE the isFullyApproved status
    // guard, so a plain `return false` there would leave the just-inserted
    // approval row committed even when the guard says the overall action
    // lost its race — transactionOrRaceLost + throwing RaceLost instead
    // makes the whole transaction roll back atomically.
    const changed = await transactionOrRaceLost(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return false;
      await lockForStatusChange(tx, p.requestId);
      // FIN-6: unconditional for every level, not just when isFullyApproved
      // — see assertActionable's doc comment.
      if (!(await assertActionable(p.requestId, msg.tenantId, p.level, tx))) return false;

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
        // Kept as defense in depth even though assertActionable already
        // confirmed the request was under_review moments ago while holding
        // the lock, so this should always succeed in practice — correct by
        // construction, not by an argument about what else could be running.
        const ok = await reqRepo.updateStatus(tx, p.requestId, msg.tenantId, "approved", msg.actorId, ["under_review"]);
        if (!ok) {
          log.warn(
            { requestId: p.requestId, level: p.level },
            "approval lost the race: a concurrent action already moved the request out of under_review — rolling back this approval entirely",
          );
          throw new RaceLost();
        }
        // Citizen-meaningful transition: the request is now FULLY approved
        // (both maker and checker levels cleared), not merely one internal
        // approval step — a level-1 checker sign-off is not yet news the
        // citizen needs. reqRepo.findByIdTx is a plain SELECT scoped to
        // this already-open tx (not scopedRead, which would open a nested
        // transaction on the same pool connection — see this service's
        // cross-events.ts and the RACE-2/RACE-3 doc comments in this file
        // for why that class of bug matters here), so this read is safe
        // immediately after the write above.
        const request = await reqRepo.findByIdTx(tx, p.requestId, msg.tenantId);
        if (request) {
          await emitMunicipalNotification(tx, ctxOf(msg), {
            eventType: municipalDecisionNotificationEventType(MUNICIPAL_EVENT_TYPES.statusChanged, "approved"),
            recipient: request.applicantName,
            recipientId: p.requestId,
            variables: {
              requestId: p.requestId,
              requestNumber: request.requestNumber,
              decision: "approved",
              refundAmountMinor: request.refundAmountMinor.toString(),
              currency: request.currency,
            },
          });
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
      // FIN-6: same unconditional check as approve/return — reject was
      // already correctly unconditional on its OWN later updateStatus call,
      // but uses the shared helper too now for uniformity (one guard shape
      // for all three actions, not "two of them happen to be fine and one
      // wasn't").
      if (!(await assertActionable(p.requestId, msg.tenantId, p.level, tx))) return false;

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
      // a racing approve that already fully approved it. Defense in depth,
      // same reasoning as approveRequest above.
      const ok = await reqRepo.updateStatus(tx, p.requestId, msg.tenantId, "rejected", msg.actorId, ["under_review"]);
      if (!ok) {
        log.warn(
          { requestId: p.requestId },
          "rejection lost the race: a concurrent action already moved the request out of under_review — rolling back this rejection entirely",
        );
        throw new RaceLost();
      }
      // Citizen-meaningful transition: same tx-scoped re-read reasoning as
      // approveRequest above.
      const request = await reqRepo.findByIdTx(tx, p.requestId, msg.tenantId);
      if (request) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: municipalDecisionNotificationEventType(MUNICIPAL_EVENT_TYPES.statusChanged, "rejected"),
          recipient: request.applicantName,
          recipientId: p.requestId,
          variables: {
            requestId: p.requestId,
            requestNumber: request.requestNumber,
            decision: "rejected",
            remarks: p.remarks,
          },
        });
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
      // FIN-6: same unconditional check as approve/reject.
      if (!(await assertActionable(p.requestId, msg.tenantId, p.level, tx))) return false;

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
      // RACE-1: return is only valid from under_review. Defense in depth,
      // same reasoning as approveRequest above.
      const ok = await reqRepo.updateStatus(tx, p.requestId, msg.tenantId, "requested", msg.actorId, ["under_review"]);
      if (!ok) {
        log.warn(
          { requestId: p.requestId },
          "return lost the race: a concurrent action already moved the request out of under_review — rolling back this return (and the approval it would have superseded) entirely",
        );
        throw new RaceLost();
      }
      // Citizen-meaningful transition: a return sends the request back to
      // the citizen for correction — genuinely actionable, same tx-scoped
      // re-read reasoning as approveRequest above.
      const request = await reqRepo.findByIdTx(tx, p.requestId, msg.tenantId);
      if (request) {
        await emitMunicipalNotification(tx, ctxOf(msg), {
          eventType: municipalDecisionNotificationEventType(MUNICIPAL_EVENT_TYPES.statusChanged, "returned"),
          recipient: request.applicantName,
          recipientId: p.requestId,
          variables: {
            requestId: p.requestId,
            requestNumber: request.requestNumber,
            decision: "returned",
            remarks: p.remarks,
          },
        });
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
