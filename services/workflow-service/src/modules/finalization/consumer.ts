import type { Queue } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { pino } from "pino";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { instanceFinalizations } from "./schema.js";
import { instances } from "../instances/schema.js";

const AUDIT_TOPIC = "audit.event.record";

const log = pino({ name: "workflow-finalization-consumer" });

export function registerFinalizationConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.finalizeInstance, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const inst = await tx.select({ id: instances.id }).from(instances)
          .where(and(eq(instances.id, p.id), eq(instances.tenantId, p.tenantId))).limit(1);
        if (!inst[0]) return;
        const existing = await tx.select().from(instanceFinalizations)
          .where(eq(instanceFinalizations.instanceId, p.id)).limit(1);
        if (existing[0]) return;
        await tx.insert(instanceFinalizations).values({ tenantId: p.tenantId, instanceId: p.id, finalizedBy: msg.actorId });
        await enqueue(tx, {
          topic: EVENTS.instanceFinalized, eventType: EVENTS.instanceFinalized,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId || randomUUID(),
          payload: { instanceId: p.id, finalizedBy: msg.actorId },
        });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow-service", action: "finalize", resourceType: "instance", resourceId: p.id, outcome: "success" } });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "finalizeInstance failed"); throw err; }
  });

  queue.subscribe(COMMANDS.reverseInstance, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string; impact: Record<string, unknown> };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const rows = await tx.update(instanceFinalizations)
          .set({
            reversed: true, reversedBy: msg.actorId, reversedAt: new Date(),
            reversalReason: p.reason, impact: p.impact, updatedAt: new Date(),
          })
          .where(and(
            eq(instanceFinalizations.instanceId, p.id),
            eq(instanceFinalizations.tenantId, p.tenantId),
            eq(instanceFinalizations.reversed, false),
          )).returning();
        if (!rows[0]) return;
        await enqueue(tx, {
          topic: EVENTS.instanceReversed, eventType: EVENTS.instanceReversed,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId || randomUUID(),
          payload: { instanceId: p.id, reversedBy: msg.actorId, reason: p.reason, impact: p.impact },
        });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow-service", action: "process", resourceType: "finalization", resourceId: p.id, outcome: "success" } });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "reverseInstance failed"); throw err; }
  });
}
