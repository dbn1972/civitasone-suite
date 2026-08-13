import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as reqRepo from "../requests/repo.js";
import { isFullyApproved } from "./domain.js";

const log = pino({ name: "refund.processing.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerProcessingConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.reviewRequest, async (msg) => {
    const p = msg.payload as { requestId: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
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
    });
  });

  queue.subscribe(COMMANDS.approveRequest, async (msg) => {
    const p = msg.payload as {
      id: string;
      requestId: string;
      tenantId: string;
      level: number;
      remarks?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
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
    });
    log.info({ id: p.id, requestId: p.requestId, level: p.level }, "approval recorded");
  });

  queue.subscribe(COMMANDS.rejectRequest, async (msg) => {
    const p = msg.payload as {
      id: string;
      requestId: string;
      tenantId: string;
      level: number;
      remarks: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
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
    });
  });

  queue.subscribe(COMMANDS.returnRequest, async (msg) => {
    const p = msg.payload as {
      id: string;
      requestId: string;
      tenantId: string;
      level: number;
      remarks: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
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
    });
  });
}
