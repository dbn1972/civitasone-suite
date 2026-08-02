import type { Queue } from "@civitasone/queue";
import { eq, and } from "drizzle-orm";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { withTenant } from "../../shared/scope.js";
import { COMMANDS } from "../../topics.js";
import { customRecords } from "../entities/schema.js";

export function registerRecordConsumers(q: Queue): void {
  q.subscribe(COMMANDS.RECORD_CREATE, async (msg) => {
    const p = msg.payload as Record<string, any>;
    await withTenant(p.tenantId, async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(customRecords).values({
        id: p.id, tenantId: p.tenantId, entityDefId: p.entityId, data: p.data,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, { topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "metadata", action: "create_record", resourceType: "custom_record", resourceId: p.id, outcome: "success" } });
    });
  });
  q.subscribe(COMMANDS.RECORD_UPDATE, async (msg) => {
    const p = msg.payload as Record<string, any>;
    await withTenant(p.tenantId, async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await tx.select().from(customRecords)
        .where(and(eq(customRecords.id, p.id), eq(customRecords.tenantId, p.tenantId))).limit(1);
      if (!existing[0]) return;
      await tx.update(customRecords)
        .set({ data: p.data, updatedAt: new Date(), updatedBy: msg.actorId, version: existing[0].version + 1 })
        .where(and(eq(customRecords.id, p.id), eq(customRecords.tenantId, p.tenantId)));
      await enqueue(tx, { topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "metadata", action: "update_record", resourceType: "custom_record", resourceId: p.id, outcome: "success" } });
    });
  });
  q.subscribe(COMMANDS.RECORD_DELETE, async (msg) => {
    const p = msg.payload as Record<string, any>;
    await withTenant(p.tenantId, async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.delete(customRecords)
        .where(and(eq(customRecords.id, p.id), eq(customRecords.tenantId, p.tenantId)));
      await enqueue(tx, { topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "metadata", action: "delete_record", resourceType: "custom_record", resourceId: p.id, outcome: "success" } });
    });
  });
}
