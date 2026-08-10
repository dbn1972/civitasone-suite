import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { emitMunicipalFeeChallan, emitMunicipalNotification, municipalDecisionNotificationEventType } from "../../shared/cross-events.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as appRepo from "../applications/repo.js";
import { generatePermitNumber, generateVerificationCode } from "./domain.js";

const log = pino({ name: "event.permits.consumer" });

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
      validFrom: string;
      validUntil: string;
      conditions?: Record<string, unknown>;
    };
    const permitNumber = generatePermitNumber("ULB", Date.now() % 999999);
    const verificationCode = generateVerificationCode();

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertPermit(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        permitNumber,
        applicationId: p.applicationId,
        status: "issued",
        issuedAt: new Date(),
        validFrom: new Date(p.validFrom),
        validUntil: new Date(p.validUntil),
        conditions: p.conditions ?? null,
        verificationCode,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await appRepo.updateStatus(tx, p.applicationId, msg.tenantId, "permitted", msg.actorId);
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
        },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "permit.issue",
        resourceType: "event_permit",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, permitNumber }, "event permit issued");
  });

  queue.subscribe(COMMANDS.revokePermit, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateStatus(tx, p.id, msg.tenantId, "revoked", msg.actorId);
      await enqueue(tx, {
        topic: EVENTS.permitRevoked,
        eventType: EVENTS.permitRevoked,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { permitId: p.id, reason: p.reason },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "permit.revoke",
        resourceType: "event_permit",
        resourceId: p.id,
      });
    });
  });
}
