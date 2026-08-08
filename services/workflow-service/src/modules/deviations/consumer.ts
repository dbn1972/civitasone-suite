import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { DeviationStatus } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";
const log = pino({ name: "workflow-deviations-consumer" });
export function registerDeviationConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.raiseDeviation, async (msg) => {
    const p = msg.payload as any;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.raise({
          tenantId: p.tenantId, entityType: p.entityType, entityId: p.entityId,
          deviationType: p.deviationType, reason: p.reason,
          expiresAt: p.expiresAt ? new Date(p.expiresAt) : null,
          actorId: msg.actorId, correlationId: msg.correlationId,
        });
        await enqueue(tx, { topic: EVENTS.deviationRaised, eventType: EVENTS.deviationRaised,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { id: p.id } });
          await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow-service", action: "raise", resourceType: "deviation", resourceId: p.id, outcome: "success" } });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "raiseDeviation failed"); throw err; }
  });
  queue.subscribe(COMMANDS.reviewDeviation, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; status: DeviationStatus; note?: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.review({ tenantId: p.tenantId, id: p.id, status: p.status, reviewerId: msg.actorId, note: p.note, correlationId: msg.correlationId });
        await enqueue(tx, { topic: EVENTS.deviationReviewed, eventType: EVENTS.deviationReviewed,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { id: p.id, status: p.status } });
          await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow-service", action: "review", resourceType: "deviation", resourceId: p.id, outcome: "success" } });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "reviewDeviation failed"); throw err; }
  });
  queue.subscribe(COMMANDS.revokeDeviation, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.revoke(p.tenantId, p.id, msg.actorId, msg.correlationId);
        await enqueue(tx, { topic: EVENTS.deviationRevoked, eventType: EVENTS.deviationRevoked,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { id: p.id } });
          await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow-service", action: "process", resourceType: "deviations", resourceId: p.id, outcome: "success" } });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "revokeDeviation failed"); throw err; }
  });
}
