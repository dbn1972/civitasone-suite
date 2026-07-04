import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, CONSUMED_EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { computeRtiDeadline, toDateString } from "./domain.js";

export function registerRtiConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.rtiFile, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; rtiNo: string; subject: string;
      description: string; cpioRef: string; citizenId?: string;
    };
    const now = new Date();
    const deadline = toDateString(computeRtiDeadline(now));
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRti(tx, {
        id: p.id, tenantId: p.tenantId, citizenId: p.citizenId ?? null,
        rtiNo: p.rtiNo, subject: p.subject, description: p.description,
        cpioRef: p.cpioRef, deadline, status: "filed",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.rtiFiled, eventType: EVENTS.rtiFiled,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          rtiId: p.id, rtiNo: p.rtiNo, subject: p.subject,
          cpioRef: p.cpioRef, deadline, citizenId: p.citizenId,
        },
      });
      await enqueue(tx, {
        topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: EVENTS.rtiFiled,
          recipient: p.cpioRef,
          recipientId: p.cpioRef,
          variables: { rtiId: p.id, rtiNo: p.rtiNo, deadline },
        }),
      });
      await audit(tx, msg, "file", "citizen_rti", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "rti", p.id));
  });

  queue.subscribe(COMMANDS.rtiResponseReceive, async (msg) => {
    const p = msg.payload as { id: string; rtiId: string; tenantId: string; responseUrl: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertResponse(tx, {
        id: p.id, tenantId: p.tenantId, rtiId: p.rtiId,
        responseUrl: p.responseUrl, respondedBy: msg.actorId,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.updateRti(tx, p.rtiId, msg.tenantId, { status: "responded", updatedBy: msg.actorId });
      await audit(tx, msg, "respond", "citizen_rti", p.rtiId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "rti", p.rtiId));
  });

  // RTI Act 2005 §6(3): transfer to the concerned PIO within 5 days.
  queue.subscribe(COMMANDS.rtiTransfer, async (msg) => {
    const p = msg.payload as { id: string; rtiId: string; tenantId: string; toAuthority: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const rti = await repo.findRtiByIdTx(tx, p.rtiId, msg.tenantId);
      if (!rti) return;
      await repo.updateRti(tx, p.rtiId, msg.tenantId, {
        status: "transferred", cpioRef: p.toAuthority, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.rtiTransferred, eventType: EVENTS.rtiTransferred,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { rtiId: p.rtiId, rtiNo: rti.rtiNo, toAuthority: p.toAuthority },
      });
      await enqueue(tx, {
        topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: EVENTS.rtiTransferred,
          recipient: p.toAuthority,
          recipientId: p.toAuthority,
          variables: { rtiId: p.rtiId, rtiNo: rti.rtiNo },
        }),
      });
      await audit(tx, msg, "transfer", "citizen_rti", p.rtiId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "rti", p.rtiId));
  });

  queue.subscribe(COMMANDS.rtiAppeal, async (msg) => {
    const p = msg.payload as { id: string; rtiId: string; tenantId: string; appealType: string; grounds: string; ownerCitizenId?: string | null };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // P0-1: re-assert ownership binding established at the route (defence in depth).
      const rti = await repo.findRtiByIdTx(tx, p.rtiId, msg.tenantId);
      if (!rti) return;
      if (p.ownerCitizenId != null && rti.citizenId !== p.ownerCitizenId) return;
      await repo.insertAppeal(tx, {
        id: p.id, tenantId: p.tenantId, rtiId: p.rtiId,
        appealType: p.appealType, grounds: p.grounds, status: "filed",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.updateRti(tx, p.rtiId, msg.tenantId, { status: "appealed", updatedBy: msg.actorId });
      await audit(tx, msg, "appeal", "citizen_rti", p.rtiId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "rti", p.rtiId));
  });

  queue.subscribe(CONSUMED_EVENTS.estabRtiResponded, async (msg) => {
    const p = msg.payload as { rtiId: string; tenantId: string; responseUrl: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const rti = await repo.findRtiByIdTx(tx, p.rtiId, msg.tenantId);
      if (!rti) return;
      await repo.insertResponse(tx, {
        tenantId: p.tenantId, rtiId: p.rtiId,
        responseUrl: p.responseUrl, respondedBy: msg.actorId,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.updateRti(tx, p.rtiId, msg.tenantId, { status: "responded", updatedBy: msg.actorId });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "rti", p.rtiId));
  });

  /**
   * P0-2: SLA sweep tick for RTIs (RTI Act 2005 §7, 30-day deadline). Published
   * by the scheduler with a deterministic messageId so a given overdue RTI only
   * breaches once. Re-validates the deadline inside the tx and emits a breach +
   * escalation notification to the CPIO.
   */
  queue.subscribe(COMMANDS.rtiSlaCheck, async (msg) => {
    const p = msg.payload as { tenantId: string; rtiId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const rti = await repo.findRtiByIdTx(tx, p.rtiId, msg.tenantId);
      if (!rti) return;
      if (rti.status === "responded" || rti.status === "appealed") return;
      const deadline = new Date(rti.deadline.toString());
      if (new Date() <= deadline) return;
      await enqueue(tx, {
        topic: EVENTS.rtiSlaBreached, eventType: EVENTS.rtiSlaBreached,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { rtiId: p.rtiId, rtiNo: rti.rtiNo, cpioRef: rti.cpioRef, deadline: rti.deadline.toString() },
      });
      await enqueue(tx, {
        topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: EVENTS.rtiSlaBreached,
          recipient: rti.cpioRef,
          recipientId: rti.cpioRef,
          variables: { rtiId: p.rtiId, rtiNo: rti.rtiNo, deadline: rti.deadline.toString() },
        }),
      });
      await audit(tx, msg, "sla_breached", "citizen_rti", p.rtiId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "rti", p.rtiId));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "citizen", action, resourceType, resourceId, outcome: "success" },
  });
}
