import { pino } from "pino";
import { randomInt } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as allotmentsRepo from "../allotments/repo.js";
import { LIFECYCLE_ACTIONABLE_STATUSES } from "../allotments/domain.js";
import { generateRequestNumber, fromStatusesFor } from "./domain.js";

const log = pino({ name: "market.lifecycle.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerLifecycleConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.requestTransfer, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      allotmentId: string;
      requestType: string;
      transfereeName: string;
      transfereeAadhaar?: string;
      reason?: string;
    };
    // Mitigation, not a full fix — same Date.now()%999999 collision pattern
    // flagged across every service in this pass; see the PR description.
    const requestNumber = generateRequestNumber("ULB", randomInt(1, 999999));

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRequest(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        allotmentId: p.allotmentId,
        requestNumber,
        requestType: "transfer",
        status: "submitted",
        transfereeName: p.transfereeName,
        transfereeAadhaar: p.transfereeAadhaar ?? null,
        reason: p.reason ?? null,
        approvedBy: null,
        completedAt: null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.transferRequested,
        eventType: EVENTS.transferRequested,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { requestId: p.id, requestNumber, allotmentId: p.allotmentId },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "lifecycle.request_transfer",
        resourceType: "market_lifecycle_request",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, requestNumber }, "market transfer requested");
  });

  queue.subscribe(COMMANDS.requestCancellation, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; allotmentId: string; reason?: string };
    // Mitigation, not a full fix — same Date.now()%999999 collision pattern
    // flagged across every service in this pass; see the PR description.
    const requestNumber = generateRequestNumber("ULB", randomInt(1, 999999));

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRequest(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        allotmentId: p.allotmentId,
        requestNumber,
        requestType: "cancellation",
        status: "submitted",
        transfereeName: null,
        transfereeAadhaar: null,
        reason: p.reason ?? null,
        approvedBy: null,
        completedAt: null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.cancellationRequested,
        eventType: EVENTS.cancellationRequested,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { requestId: p.id, requestNumber, allotmentId: p.allotmentId },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "lifecycle.request_cancellation",
        resourceType: "market_lifecycle_request",
        resourceId: p.id,
      });
    });
  });

  queue.subscribe(COMMANDS.initiateEviction, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; allotmentId: string; reason: string };
    // Mitigation, not a full fix — same Date.now()%999999 collision pattern
    // flagged across every service in this pass; see the PR description.
    const requestNumber = generateRequestNumber("ULB", randomInt(1, 999999));

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRequest(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        allotmentId: p.allotmentId,
        requestNumber,
        requestType: "eviction",
        status: "submitted",
        transfereeName: null,
        transfereeAadhaar: null,
        reason: p.reason,
        approvedBy: null,
        completedAt: null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.evictionInitiated,
        eventType: EVENTS.evictionInitiated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { requestId: p.id, requestNumber, allotmentId: p.allotmentId },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "lifecycle.initiate_eviction",
        resourceType: "market_lifecycle_request",
        resourceId: p.id,
      });
    });
  });

  queue.subscribe(COMMANDS.approveRequest, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const updated = await repo.updateStatus(tx, p.id, msg.tenantId, "approved", fromStatusesFor("approved"), msg.actorId, {
        approvedBy: msg.actorId,
      });
      if (!updated) return;
      await enqueue(tx, {
        topic: EVENTS.requestApproved,
        eventType: EVENTS.requestApproved,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { requestId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "lifecycle.approve",
        resourceType: "market_lifecycle_request",
        resourceId: p.id,
      });
    });
  });

  queue.subscribe(COMMANDS.rejectRequest, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const updated = await repo.updateStatus(tx, p.id, msg.tenantId, "rejected", fromStatusesFor("rejected"), msg.actorId);
      if (!updated) return;
      await enqueue(tx, {
        topic: EVENTS.requestRejected,
        eventType: EVENTS.requestRejected,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { requestId: p.id, reason: p.reason },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "lifecycle.reject",
        resourceType: "market_lifecycle_request",
        resourceId: p.id,
        // The rejection's own reason previously only reached this outbox event
        // — the row's `reason` column keeps showing the ORIGINAL citizen
        // submission forever (a second `decision_reason` column would be the
        // fuller fix; not done in this pass). At least preserved in the audit
        // trail now.
        details: { reason: p.reason },
      });
    });
  });

  queue.subscribe(COMMANDS.completeRequest, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // CRITICAL fix: this handler previously never touched marketAllotments at
      // all — it only flipped the REQUEST's own status to "completed". Combined
      // with "active"/"transferred"/"cancelled"/"evicted" never being assigned
      // anywhere else either, there was NO code path in this service that ever
      // actually marked an allotment as evicted, cancelled, or transferred: an
      // admin could fully submit, approve, and "complete" an eviction, and the
      // target allotment's status (and, for transfers, its allottee) never
      // changed — the stall never actually freed up for reallotment.
      const request = await repo.findById(p.id, msg.tenantId);
      if (!request) return;
      const targetAllotmentStatus =
        request.requestType === "transfer" ? "transferred" :
        request.requestType === "eviction" ? "evicted" :
        "cancelled"; // "cancellation"
      const allotmentUpdated = await allotmentsRepo.updateStatus(
        tx,
        request.allotmentId,
        msg.tenantId,
        targetAllotmentStatus,
        LIFECYCLE_ACTIONABLE_STATUSES,
        msg.actorId,
        request.requestType === "transfer"
          ? { allotteeName: request.transfereeName ?? undefined, allotteeAadhaar: request.transfereeAadhaar }
          : undefined,
      );
      if (!allotmentUpdated) {
        // Abort the whole completion rather than mark the lifecycle request
        // "completed" while the allotment it's about never actually changed —
        // that combination (request says done, allotment says nothing
        // happened) is exactly the silent-no-op this fix closes.
        throw new Error(`allotment ${request.allotmentId} not in an actionable status for ${request.requestType}; aborting lifecycle completion for ${p.id}`);
      }
      const updated = await repo.updateStatus(tx, p.id, msg.tenantId, "completed", fromStatusesFor("completed"), msg.actorId, {
        completedAt: new Date(),
      });
      if (!updated) return;
      await enqueue(tx, {
        topic: EVENTS.requestCompleted,
        eventType: EVENTS.requestCompleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { requestId: p.id, allotmentId: request.allotmentId, newAllotmentStatus: targetAllotmentStatus },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "lifecycle.complete",
        resourceType: "market_lifecycle_request",
        resourceId: p.id,
      });
    });
  });
}
