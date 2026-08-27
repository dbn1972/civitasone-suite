import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { generatePermitNumber, generateVerificationCode, calculateValidUntil } from "./domain.js";

const log = pino({ name: "shop.permits.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerPermitConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.issuePermit, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      applicationId: string;
      establishmentName: string;
      validityMonths: number;
    };
    const now = new Date();
    const permitNumber = generatePermitNumber("ULB", Date.now() % 999999);
    const verificationCode = generateVerificationCode();
    const validUntil = calculateValidUntil(now, p.validityMonths);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertPermit(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        applicationId: p.applicationId,
        permitNumber,
        establishmentName: p.establishmentName,
        permitStatus: "active",
        issuedAt: now,
        validFrom: now,
        validUntil,
        verificationCode,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.permitIssued,
        eventType: EVENTS.permitIssued,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          permitId: p.id,
          permitNumber,
          applicationId: p.applicationId,
          establishmentName: p.establishmentName,
          validFrom: now.toISOString(),
          validUntil: validUntil.toISOString(),
          verificationCode,
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "permit.issue",
        resourceType: "shop_permit",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, permitNumber }, "permit issued");
  });

  queue.subscribe(COMMANDS.suspendPermit, async (msg) => {
    const p = msg.payload as { permitId: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updatePermitStatus(tx, p.permitId, msg.tenantId, "suspended", {
        suspendedAt: new Date(),
        suspensionReason: p.reason,
      }, msg.actorId);
      await repo.insertAction(tx, {
        id: randomUUID(),
        tenantId: msg.tenantId,
        permitId: p.permitId,
        actionType: "suspension",
        reason: p.reason,
        effectiveFrom: new Date(),
        performedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.permitSuspended,
        eventType: EVENTS.permitSuspended,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { permitId: p.permitId, reason: p.reason },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "permit.suspend",
        resourceType: "shop_permit",
        resourceId: p.permitId,
      });
    });
  });

  queue.subscribe(COMMANDS.cancelPermit, async (msg) => {
    const p = msg.payload as { permitId: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updatePermitStatus(tx, p.permitId, msg.tenantId, "cancelled", {
        cancelledAt: new Date(),
        cancellationReason: p.reason,
      }, msg.actorId);
      await repo.insertAction(tx, {
        id: randomUUID(),
        tenantId: msg.tenantId,
        permitId: p.permitId,
        actionType: "cancellation",
        reason: p.reason,
        effectiveFrom: new Date(),
        performedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.permitCancelled,
        eventType: EVENTS.permitCancelled,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { permitId: p.permitId, reason: p.reason },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "permit.cancel",
        resourceType: "shop_permit",
        resourceId: p.permitId,
      });
    });
  });

  queue.subscribe(COMMANDS.restorePermit, async (msg) => {
    const p = msg.payload as { permitId: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updatePermitStatus(tx, p.permitId, msg.tenantId, "active", {
        suspendedAt: null,
        suspensionReason: null,
      }, msg.actorId);
      await repo.insertAction(tx, {
        id: randomUUID(),
        tenantId: msg.tenantId,
        permitId: p.permitId,
        actionType: "restoration",
        reason: p.reason,
        effectiveFrom: new Date(),
        performedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.permitRestored,
        eventType: EVENTS.permitRestored,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { permitId: p.permitId, reason: p.reason },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "permit.restore",
        resourceType: "shop_permit",
        resourceId: p.permitId,
      });
    });
  });

  queue.subscribe(COMMANDS.issueNotice, async (msg) => {
    const p = msg.payload as {
      id: string;
      permitId: string;
      tenantId: string;
      noticeDetails: Record<string, unknown>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertAction(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        permitId: p.permitId,
        actionType: "notice",
        noticeDetails: p.noticeDetails,
        effectiveFrom: new Date(),
        performedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.noticeIssued,
        eventType: EVENTS.noticeIssued,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { noticeId: p.id, permitId: p.permitId },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "permit.notice",
        resourceType: "shop_permit_action",
        resourceId: p.id,
      });
    });
  });
}
