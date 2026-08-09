import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { emitMunicipalFeeChallan, emitMunicipalNotification, municipalDecisionNotificationEventType } from "../../shared/cross-events.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { generatePermitNumber, generateVerificationCode, calculateValidUntil } from "./domain.js";

const log = pino({ name: "building.permits.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerPermitConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.issuePermit, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; applicationId: string; conditions?: Array<{ condition: string; category: string }>; validityMonths: number };
    const now = new Date();
    const permitNumber = generatePermitNumber("ULB", Date.now() % 999999);
    const verificationCode = generateVerificationCode();
    const validUntil = calculateValidUntil(now, p.validityMonths);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertPermit(tx, { id: p.id, tenantId: msg.tenantId, applicationId: p.applicationId, permitNumber, status: "active", issuedAt: now, validUntil, conditions: p.conditions ?? null, verificationCode, createdBy: msg.actorId, updatedBy: msg.actorId });
      await enqueue(tx, { topic: EVENTS.permitIssued, eventType: EVENTS.permitIssued, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { permitId: p.id, permitNumber, applicationId: p.applicationId, validUntil: validUntil.toISOString(), verificationCode } });
      await writeAudit(tx, ctxOf(msg), { action: "permit.issue", resourceType: "building_permit", resourceId: p.id });
    });
    log.info({ id: p.id, permitNumber }, "building permit issued");
  });

  queue.subscribe(COMMANDS.suspendPermit, async (msg) => {
    const p = msg.payload as { permitId: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updatePermitStatus(tx, p.permitId, msg.tenantId, "suspended", { suspendedAt: new Date(), suspensionReason: p.reason }, msg.actorId);
      await enqueue(tx, { topic: EVENTS.permitSuspended, eventType: EVENTS.permitSuspended, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { permitId: p.permitId, reason: p.reason } });
      await writeAudit(tx, ctxOf(msg), { action: "permit.suspend", resourceType: "building_permit", resourceId: p.permitId });
    });
  });

  queue.subscribe(COMMANDS.cancelPermit, async (msg) => {
    const p = msg.payload as { permitId: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updatePermitStatus(tx, p.permitId, msg.tenantId, "cancelled", { cancelledAt: new Date(), cancellationReason: p.reason }, msg.actorId);
      await enqueue(tx, { topic: EVENTS.permitCancelled, eventType: EVENTS.permitCancelled, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { permitId: p.permitId, reason: p.reason } });
      await writeAudit(tx, ctxOf(msg), { action: "permit.cancel", resourceType: "building_permit", resourceId: p.permitId });
    });
  });

  queue.subscribe(COMMANDS.restorePermit, async (msg) => {
    const p = msg.payload as { permitId: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updatePermitStatus(tx, p.permitId, msg.tenantId, "active", { suspendedAt: null, suspensionReason: null }, msg.actorId);
      await enqueue(tx, { topic: EVENTS.permitRestored, eventType: EVENTS.permitRestored, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { permitId: p.permitId, reason: p.reason } });
      await writeAudit(tx, ctxOf(msg), { action: "permit.restore", resourceType: "building_permit", resourceId: p.permitId });
    });
  });
}
