import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { generateRequestNumber } from "./domain.js";

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
    const requestNumber = generateRequestNumber("ULB", Date.now() % 999999);

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
    const requestNumber = generateRequestNumber("ULB", Date.now() % 999999);

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
    const requestNumber = generateRequestNumber("ULB", Date.now() % 999999);

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
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "approved", msg.actorId, {
        approvedBy: msg.actorId,
      });
      if (!ok) return;
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
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "rejected", msg.actorId);
      if (!ok) return;
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
      });
    });
  });

  queue.subscribe(COMMANDS.completeRequest, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "completed", msg.actorId, {
        completedAt: new Date(),
      });
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.requestCompleted,
        eventType: EVENTS.requestCompleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { requestId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "lifecycle.complete",
        resourceType: "market_lifecycle_request",
        resourceId: p.id,
      });
    });
  });
}
