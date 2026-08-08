import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const AUDIT_TOPIC = "audit.event.record";
import * as repo from "./repo.js";
const log = pino({ name: "workflow-workbaskets-consumer" });
export function registerWorkbasketConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.upsertWorkbasket, async (msg) => {
    const p = msg.payload as any;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.upsert({
          tenantId: p.tenantId, code: p.code, name: p.name, description: p.description,
          filter: p.filter, sortOrder: p.sortOrder, actorId: msg.actorId,
        });
        await enqueue(tx, { topic: EVENTS.workbasketUpserted, eventType: EVENTS.workbasketUpserted,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { code: p.code } });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow-service", action: "upsert", resourceType: "workbasket", resourceId: p.code, outcome: "success" } });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "upsertWorkbasket failed"); throw err; }
  });
}
