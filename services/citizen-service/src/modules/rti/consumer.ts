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
      await repo.updateRti(tx, p.rtiId, { status: "responded", updatedBy: msg.actorId });
      await audit(tx, msg, "respond", "citizen_rti", p.rtiId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "rti", p.rtiId));
  });

  queue.subscribe(COMMANDS.rtiAppeal, async (msg) => {
    const p = msg.payload as { id: string; rtiId: string; tenantId: string; appealType: string; grounds: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertAppeal(tx, {
        id: p.id, tenantId: p.tenantId, rtiId: p.rtiId,
        appealType: p.appealType, grounds: p.grounds, status: "filed",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.updateRti(tx, p.rtiId, { status: "appealed", updatedBy: msg.actorId });
      await audit(tx, msg, "appeal", "citizen_rti", p.rtiId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "rti", p.rtiId));
  });

  queue.subscribe(CONSUMED_EVENTS.estabRtiResponded, async (msg) => {
    const p = msg.payload as { rtiId: string; tenantId: string; responseUrl: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const rti = await repo.findRtiByIdTx(tx, p.rtiId);
      if (!rti) return;
      await repo.insertResponse(tx, {
        tenantId: p.tenantId, rtiId: p.rtiId,
        responseUrl: p.responseUrl, respondedBy: msg.actorId,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.updateRti(tx, p.rtiId, { status: "responded", updatedBy: msg.actorId });
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
