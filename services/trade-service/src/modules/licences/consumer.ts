import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { generateLicenceNumber, generateVerificationCode, calculateValidUntil } from "./domain.js";

const log = pino({ name: "trade.licences.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerLicenceConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.issueLicence, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; applicationId: string; tradeCategory: string; validityMonths: number };
    const now = new Date();
    const licenceNumber = generateLicenceNumber("ULB", Date.now() % 999999);
    const verificationCode = generateVerificationCode();
    const validUntil = calculateValidUntil(now, p.validityMonths);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertLicence(tx, {
        id: p.id, tenantId: msg.tenantId, applicationId: p.applicationId, licenceNumber, status: "active", tradeCategory: p.tradeCategory, issuedAt: now, validFrom: now, validUntil, verificationCode, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.insertDirectoryEntry(tx, {
        verificationCode, tenantId: msg.tenantId, licenceId: p.id, licenceNumber, tradeCategory: p.tradeCategory, status: "active", issuedAt: now, validFrom: now, validUntil,
      });
      await enqueue(tx, { topic: EVENTS.licenceIssued, eventType: EVENTS.licenceIssued, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { licenceId: p.id, licenceNumber, applicationId: p.applicationId, tradeCategory: p.tradeCategory, validFrom: now.toISOString(), validUntil: validUntil.toISOString(), verificationCode } });
      await writeAudit(tx, ctxOf(msg), { action: "licence.issue", resourceType: "trade_licence", resourceId: p.id });
    });
    log.info({ id: p.id, licenceNumber }, "trade licence issued");
  });

  queue.subscribe(COMMANDS.suspendLicence, async (msg) => {
    const p = msg.payload as { licenceId: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateLicenceStatus(tx, p.licenceId, msg.tenantId, "suspended", { suspendedAt: new Date(), suspensionReason: p.reason }, msg.actorId);
      await repo.insertAction(tx, { id: randomUUID(), tenantId: msg.tenantId, licenceId: p.licenceId, actionType: "suspension", reason: p.reason, effectiveFrom: new Date(), performedBy: msg.actorId });
      await cache.invalidateResourceAfterCommit(tx, msg.tenantId, "licence");
      await enqueue(tx, { topic: EVENTS.licenceSuspended, eventType: EVENTS.licenceSuspended, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { licenceId: p.licenceId, reason: p.reason } });
      await writeAudit(tx, ctxOf(msg), { action: "licence.suspend", resourceType: "trade_licence", resourceId: p.licenceId });
    });
  });

  queue.subscribe(COMMANDS.cancelLicence, async (msg) => {
    const p = msg.payload as { licenceId: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateLicenceStatus(tx, p.licenceId, msg.tenantId, "cancelled", { cancelledAt: new Date(), cancellationReason: p.reason }, msg.actorId);
      await repo.insertAction(tx, { id: randomUUID(), tenantId: msg.tenantId, licenceId: p.licenceId, actionType: "cancellation", reason: p.reason, effectiveFrom: new Date(), performedBy: msg.actorId });
      await cache.invalidateResourceAfterCommit(tx, msg.tenantId, "licence");
      await enqueue(tx, { topic: EVENTS.licenceCancelled, eventType: EVENTS.licenceCancelled, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { licenceId: p.licenceId, reason: p.reason } });
      await writeAudit(tx, ctxOf(msg), { action: "licence.cancel", resourceType: "trade_licence", resourceId: p.licenceId });
    });
  });

  queue.subscribe(COMMANDS.restoreLicence, async (msg) => {
    const p = msg.payload as { licenceId: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateLicenceStatus(tx, p.licenceId, msg.tenantId, "active", { suspendedAt: null, suspensionReason: null }, msg.actorId);
      await repo.insertAction(tx, { id: randomUUID(), tenantId: msg.tenantId, licenceId: p.licenceId, actionType: "restoration", reason: p.reason, effectiveFrom: new Date(), performedBy: msg.actorId });
      await cache.invalidateResourceAfterCommit(tx, msg.tenantId, "licence");
      await enqueue(tx, { topic: EVENTS.licenceRestored, eventType: EVENTS.licenceRestored, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { licenceId: p.licenceId, reason: p.reason } });
      await writeAudit(tx, ctxOf(msg), { action: "licence.restore", resourceType: "trade_licence", resourceId: p.licenceId });
    });
  });

  queue.subscribe(COMMANDS.issueNotice, async (msg) => {
    const p = msg.payload as { id: string; licenceId: string; tenantId: string; noticeDetails: Record<string, unknown> };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertAction(tx, { id: p.id, tenantId: msg.tenantId, licenceId: p.licenceId, actionType: "notice", noticeDetails: p.noticeDetails, effectiveFrom: new Date(), performedBy: msg.actorId });
      await enqueue(tx, { topic: EVENTS.noticeIssued, eventType: EVENTS.noticeIssued, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { noticeId: p.id, licenceId: p.licenceId } });
      await writeAudit(tx, ctxOf(msg), { action: "licence.notice", resourceType: "trade_licence_action", resourceId: p.id });
    });
  });
}
