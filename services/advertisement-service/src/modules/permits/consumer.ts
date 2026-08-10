import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { emitMunicipalFeeChallan, emitMunicipalNotification, municipalDecisionNotificationEventType } from "../../shared/cross-events.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { generatePermitNumber, generateVerificationCode } from "./domain.js";

const log = pino({ name: "advertisement.permits.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerPermitConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.issuePermit, async (msg) => {
    const p = msg.payload as {
      id: string;
      applicationId: string;
      validFrom: string;
      validUntil: string;
      location: Record<string, unknown>;
      advertisementType: string;
    };
    const now = new Date();
    const permitNumber = generatePermitNumber("ULB", Date.now() % 999999);
    const verificationCode = generateVerificationCode();

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertPermit(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        applicationId: p.applicationId,
        permitNumber,
        status: "active",
        issuedAt: now,
        validFrom: p.validFrom,
        validUntil: p.validUntil,
        location: p.location as never,
        advertisementType: p.advertisementType,
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
        payload: { permitId: p.id, permitNumber, applicationId: p.applicationId, verificationCode },
      });
      await writeAudit(tx, ctxOf(msg), { action: "permit.issue", resourceType: "adv_permit", resourceId: p.id });
    });
    log.info({ id: p.id, permitNumber }, "advertisement permit issued");
  });

  queue.subscribe(COMMANDS.renewPermit, async (msg) => {
    const p = msg.payload as { id: string; permitId: string; renewalType: string; newValidUntil: string; feeMinor: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const permit = await repo.findById(p.permitId, msg.tenantId);
      await repo.insertRenewal(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        permitId: p.permitId,
        renewalType: p.renewalType,
        status: "approved",
        feeMinor: BigInt(p.feeMinor),
        currency: "INR",
        previousValidUntil: permit?.validUntil ?? null,
        newValidUntil: p.newValidUntil,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.permitRenewed,
        eventType: EVENTS.permitRenewed,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { renewalId: p.id, permitId: p.permitId, newValidUntil: p.newValidUntil },
      });
      await writeAudit(tx, ctxOf(msg), { action: "permit.renew", resourceType: "adv_permit", resourceId: p.permitId });
    });
  });

  queue.subscribe(COMMANDS.suspendPermit, async (msg) => {
    const p = msg.payload as { id: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "suspended", msg.actorId, {
        suspendedAt: new Date(),
        suspensionReason: p.reason,
      });
      if (!ok) return;
      await enqueue(tx, { topic: EVENTS.permitSuspended, eventType: EVENTS.permitSuspended, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { permitId: p.id, reason: p.reason } });
      await writeAudit(tx, ctxOf(msg), { action: "permit.suspend", resourceType: "adv_permit", resourceId: p.id });
    });
  });

  queue.subscribe(COMMANDS.cancelPermit, async (msg) => {
    const p = msg.payload as { id: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "cancelled", msg.actorId, {
        cancelledAt: new Date(),
        cancellationReason: p.reason,
      });
      if (!ok) return;
      await enqueue(tx, { topic: EVENTS.permitCancelled, eventType: EVENTS.permitCancelled, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { permitId: p.id, reason: p.reason } });
      await writeAudit(tx, ctxOf(msg), { action: "permit.cancel", resourceType: "adv_permit", resourceId: p.id });
    });
  });
}
