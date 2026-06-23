import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { computeRtiDeadline, toDateString } from "./domain.js";
import { autoRegisterDak } from "../files/dak-auto.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerLegalConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.courtCaseCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; caseNo: string; title: string; court: string; subject?: string; petitioner?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertCourtCase(tx, {
        id: p.id, tenantId: p.tenantId, caseNo: p.caseNo, title: p.title,
        court: p.court, subject: p.subject ?? null, petitioner: p.petitioner ?? null,
        counselRef: null, nextHearing: null, status: "pending",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "court_case", p.id);
    });
  });

  queue.subscribe(COMMANDS.courtCaseNextDate, async (msg) => {
    const p = msg.payload as { id: string; caseId: string; tenantId: string; hearingDate: string; purpose?: string; outcome?: string; nextDate?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertCaseDate(tx, {
        id: p.id, tenantId: p.tenantId, caseId: p.caseId,
        hearingDate: p.hearingDate, purpose: p.purpose ?? null,
        outcome: p.outcome ?? null, nextDate: p.nextDate ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      if (p.nextDate) {
        await repo.updateCourtCase(tx, p.caseId, { nextHearing: p.nextDate, updatedBy: msg.actorId });
      }
      await enqueue(tx, {
        topic: EVENTS.courtCaseDateSet, eventType: EVENTS.courtCaseDateSet,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { caseId: p.caseId, nextDate: p.nextDate ?? null },
      });
      await audit(tx, msg, "next_date", "court_case", p.caseId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "court_case", p.caseId));
  });

  queue.subscribe(COMMANDS.rtiCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; rtiNo: string; applicant: string; subject: string; cpioRef: string };
    const now = new Date();
    const deadline = computeRtiDeadline(now);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRti(tx, {
        id: p.id, tenantId: p.tenantId, rtiNo: p.rtiNo,
        applicant: p.applicant, subject: p.subject,
        cpioRef: p.cpioRef, deadline: toDateString(deadline),
        responseUrl: null, respondedAt: null, status: "pending",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.rtiCreated, eventType: EVENTS.rtiCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { rtiId: p.id, cpioRef: p.cpioRef, deadline: toDateString(deadline) },
      });
      await enqueue(tx, {
        topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: EVENTS.rtiCreated,
          recipient: p.cpioRef,
          recipientId: p.cpioRef,
          variables: { rtiId: p.id, deadline: toDateString(deadline) },
        }),
      });
      await autoRegisterDak(tx, msg, {
        dakNo: p.rtiNo,
        fromAddress: p.applicant,
        subject: `RTI: ${p.subject}`,
        sourceSection: "rti",
        assignedTo: p.cpioRef,
      });
      await audit(tx, msg, "create", "rti", p.id);
    });
  });

  queue.subscribe(COMMANDS.rtiRespond, async (msg) => {
    const p = msg.payload as { rtiId: string; tenantId: string; responseUrl: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateRti(tx, p.rtiId, {
        responseUrl: p.responseUrl, respondedAt: new Date(),
        status: "responded", updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.rtiResponded, eventType: EVENTS.rtiResponded,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { rtiId: p.rtiId, tenantId: p.tenantId, responseUrl: p.responseUrl },
      });
      await audit(tx, msg, "respond", "rti", p.rtiId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "rti", p.rtiId));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "estab", action, resourceType, resourceId, outcome: "success" },
  });
}
