import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { generateRequestNumber } from "./domain.js";

const log = pino({ name: "refund.requests.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerRequestConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.createRequest, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      applicantName: string;
      applicantPhone: string;
      originalServiceType: string;
      originalTransactionRef: string;
      originalAmountMinor: string;
      refundAmountMinor: string;
      refundReason: string;
      description?: string;
      documents?: Array<{ docType: string; fileId: string; uploadedAt: string }>;
    };
    const requestNumber = generateRequestNumber("ULB", Date.now() % 999999);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRequest(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        requestNumber,
        status: "requested",
        applicantName: p.applicantName,
        applicantPhone: p.applicantPhone,
        originalServiceType: p.originalServiceType,
        originalTransactionRef: p.originalTransactionRef,
        originalAmountMinor: BigInt(p.originalAmountMinor),
        refundAmountMinor: BigInt(p.refundAmountMinor),
        refundReason: p.refundReason,
        description: p.description ?? null,
        documents: p.documents ?? [],
        currency: "INR",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.requestCreated,
        eventType: EVENTS.requestCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          requestId: p.id,
          requestNumber,
          refundAmountMinor: p.refundAmountMinor,
          currency: "INR",
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "request.create",
        resourceType: "refund_request",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, requestNumber }, "refund request created");
  });

  queue.subscribe(COMMANDS.submitRequest, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "under_review", msg.actorId);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.requestSubmitted,
        eventType: EVENTS.requestSubmitted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { requestId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "request.submit",
        resourceType: "refund_request",
        resourceId: p.id,
      });
    });
  });

  queue.subscribe(COMMANDS.withdrawRequest, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "withdrawn", msg.actorId);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.requestWithdrawn,
        eventType: EVENTS.requestWithdrawn,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { requestId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "request.withdraw",
        resourceType: "refund_request",
        resourceId: p.id,
      });
    });
  });
}
