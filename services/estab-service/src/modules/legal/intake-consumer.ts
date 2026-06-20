import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

/** citizen-service → estab: create CPIO RTI intake when citizen files RTI online */
export function registerRtiIntakeConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.citizenRtiFiled, async (msg) => {
    const p = msg.payload as {
      rtiId: string; rtiNo: string; subject: string;
      cpioRef: string; deadline: string; citizenId?: string;
    };
    const existing = await repo.findRtiById(p.rtiId);
    if (existing) return;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRti(tx, {
        id: p.rtiId, tenantId: msg.tenantId, rtiNo: p.rtiNo,
        applicant: p.citizenId ?? "citizen", subject: p.subject,
        cpioRef: p.cpioRef, deadline: p.deadline,
        responseUrl: null, respondedAt: null, status: "pending",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.rtiCreated, eventType: EVENTS.rtiCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { rtiId: p.rtiId, cpioRef: p.cpioRef, deadline: p.deadline, source: "citizen" },
      });
      await enqueue(tx, {
        topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: EVENTS.rtiCreated,
          recipient: p.cpioRef,
          recipientId: p.cpioRef,
          variables: { rtiId: p.rtiId, rtiNo: p.rtiNo, deadline: p.deadline },
        }),
      });
      await audit(tx, msg, "intake", "rti", p.rtiId);
    });
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "estab", action, resourceType, resourceId, outcome: "success" },
  });
}
