import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "hrms.visiting-cards.consumer" });
const AUDIT = "audit.event.record";

export function registerVisitingCardConsumers(queue: Queue): void {
  queue.subscribe("hrms.visiting_card.update", async (msg) => {
    const p = msg.payload as { employeeId: string; tenantId: string; fields: Record<string, unknown> };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.visiting_card.updated",
        eventType: "hrms.visiting_card.updated",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { employeeId: p.employeeId, fields: Object.keys(p.fields) },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "visiting_card_update", resourceType: "visiting_card", resourceId: p.employeeId, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:visiting_cards:*`);
    log.info({ id: msg.messageId, employeeId: p.employeeId }, "Processed visiting_card.update");
  });

  queue.subscribe("hrms.visiting_card.share", async (msg) => {
    const p = msg.payload as { employeeId: string; tenantId: string; method: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.visiting_card.shared",
        eventType: "hrms.visiting_card.shared",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { employeeId: p.employeeId, method: p.method },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "visiting_card_share", resourceType: "visiting_card", resourceId: p.employeeId, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:visiting_cards:*`);
    log.info({ id: msg.messageId, employeeId: p.employeeId }, "Processed visiting_card.share");
  });
}
