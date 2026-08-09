import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { emitMunicipalFeeChallan, emitMunicipalNotification, municipalDecisionNotificationEventType } from "../../shared/cross-events.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { generateNocNumber, generateVerificationCode, calculateValidUntil } from "./domain.js";

const log = pino({ name: "fire.nocs.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerNocConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.issueNoc, async (msg) => {
    const p = msg.payload as {
      id: string;
      applicationId: string;
      validFrom: string;
      conditions?: Record<string, unknown>;
      durationYears?: number;
    };
    const now = new Date();
    const nocNumber = generateNocNumber("ULB", new Date().getUTCFullYear(), Date.now() % 999999);
    const verificationCode = generateVerificationCode();
    const validFromDate = new Date(p.validFrom);
    const validUntil = calculateValidUntil(validFromDate, p.durationYears ?? 3);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        applicationId: p.applicationId,
        nocNumber,
        status: "active",
        issuedAt: now,
        validFrom: p.validFrom,
        validUntil: validUntil.toISOString().slice(0, 10),
        conditions: p.conditions ?? null,
        verificationCode,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.nocIssued,
        eventType: EVENTS.nocIssued,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { nocId: p.id, nocNumber, applicationId: p.applicationId, verificationCode },
      });
      
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: EVENTS.nocIssued,
        recipient: msg.actorId,
        recipientId: msg.actorId,
        variables: { applicationId: p.applicationId },
      });
      
      await emitMunicipalNotification(tx, ctxOf(msg), {
        eventType: EVENTS.nocIssued,
        recipient: msg.actorId,
        recipientId: msg.actorId,
        variables: { applicationId: p.applicationId },
      });
      await writeAudit(tx, ctxOf(msg), { action: "noc.issue", resourceType: "fire_noc", resourceId: p.id });
    });
    log.info({ id: p.id, nocNumber }, "fire NOC issued");
  });

  queue.subscribe(COMMANDS.suspendNoc, async (msg) => {
    const p = msg.payload as { nocId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.updateStatus(tx, msg.tenantId, p.nocId, "suspended", msg.actorId);
      if (!row) return;
      await enqueue(tx, { topic: EVENTS.nocSuspended, eventType: EVENTS.nocSuspended, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { nocId: p.nocId, reason: p.reason } });
      await writeAudit(tx, ctxOf(msg), { action: "noc.suspend", resourceType: "fire_noc", resourceId: p.nocId });
    });
  });

  queue.subscribe(COMMANDS.revokeNoc, async (msg) => {
    const p = msg.payload as { nocId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.updateStatus(tx, msg.tenantId, p.nocId, "revoked", msg.actorId);
      if (!row) return;
      await enqueue(tx, { topic: EVENTS.nocRevoked, eventType: EVENTS.nocRevoked, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { nocId: p.nocId, reason: p.reason } });
      await writeAudit(tx, ctxOf(msg), { action: "noc.revoke", resourceType: "fire_noc", resourceId: p.nocId });
    });
  });
}
