import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as caseRepo from "../cases/repo.js";
import * as repo from "./repo.js";
import { assertCanAdjourn } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerHearingConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.hearingCreate, async (msg) => {
    const p = msg.payload as {
      id: string; caseId: string; tenantId: string; hearingDate: string;
      court: string; purpose?: string; nextDate?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertHearing(tx, {
        id: p.id, tenantId: p.tenantId, caseId: p.caseId, hearingDate: p.hearingDate,
        court: p.court, purpose: p.purpose ?? null, nextDate: p.nextDate ?? p.hearingDate,
        status: "scheduled", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      if (p.nextDate ?? p.hearingDate) {
        await caseRepo.updateCase(tx, p.caseId, { nextDate: p.nextDate ?? p.hearingDate, updatedBy: msg.actorId });
      }
      await audit(tx, msg, "create", "hearing", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "case", p.caseId));
  });

  queue.subscribe(COMMANDS.hearingAdjourn, async (msg) => {
    const p = msg.payload as { caseId: string; hearingId: string; tenantId: string; nextDate: string; purpose?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const hearing = await repo.findHearingByIdTx(tx, p.hearingId);
      if (!hearing) throw new Error(`hearing ${p.hearingId} not found`);
      assertCanAdjourn(hearing.status ?? "scheduled");
      await repo.updateHearing(tx, p.hearingId, {
        previousDate: hearing.hearingDate, nextDate: p.nextDate,
        purpose: p.purpose ?? hearing.purpose, status: "adjourned", updatedBy: msg.actorId,
        version: (hearing.version ?? 1) + 1,
      });
      await caseRepo.updateCase(tx, p.caseId, { nextDate: p.nextDate, updatedBy: msg.actorId });
      await enqueue(tx, {
        topic: EVENTS.caseDateSet, eventType: EVENTS.caseDateSet,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { caseId: p.caseId, nextDate: p.nextDate },
      });
      await enqueue(tx, {
        topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: EVENTS.caseDateSet,
          recipient: p.caseId,
          variables: { caseId: p.caseId, nextDate: p.nextDate },
        }),
      });
      await audit(tx, msg, "adjourn", "hearing", p.hearingId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "case", p.caseId));
  });

  queue.subscribe(COMMANDS.orderRecord, async (msg) => {
    const p = msg.payload as {
      id: string; caseId: string; tenantId: string; orderType: string;
      direction?: string; deptRef?: string; summary: string; orderDate: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertOrder(tx, {
        id: p.id, tenantId: p.tenantId, caseId: p.caseId, orderType: p.orderType,
        direction: p.direction ?? null, deptRef: p.deptRef ?? null,
        summary: p.summary, orderDate: p.orderDate,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "record", "order", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "case", p.caseId));
  });
}

async function audit(tx: any, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "legal", action, resourceType, resourceId, outcome: "success" },
  });
}
