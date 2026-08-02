import type { Queue } from "@civitasone/queue";
import { eq, and } from "drizzle-orm";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { withTenant } from "../../shared/scope.js";
import { COMMANDS } from "../../topics.js";
import { entityDefinitions, fieldDefinitions } from "../entities/schema.js";

export function registerFieldConsumers(q: Queue): void {
  q.subscribe(COMMANDS.FIELD_CREATE, async (msg) => {
    const p = msg.payload as Record<string, any>;
    await withTenant(p.tenantId, async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const parent = await tx.select().from(entityDefinitions)
        .where(and(eq(entityDefinitions.id, p.entityId), eq(entityDefinitions.tenantId, p.tenantId))).limit(1);
      if (!parent[0]) return;
      await tx.insert(fieldDefinitions).values({
        id: p.id, tenantId: p.tenantId, entityDefId: p.entityId, apiName: p.apiName, label: p.label,
        fieldType: p.fieldType, isRequired: p.isRequired ?? false, isUnique: p.isUnique ?? false,
        defaultValue: p.defaultValue ?? null, picklistValues: p.picklistValues ?? null,
        lookupEntityId: p.lookupEntityId ?? null, formulaExpression: p.formulaExpression ?? null,
        sortOrder: p.sortOrder ?? 0, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, { topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "metadata", action: "create_field", resourceType: "field_definition", resourceId: p.id, outcome: "success" } });
    });
  });
  q.subscribe(COMMANDS.FIELD_UPDATE, async (msg) => {
    const p = msg.payload as Record<string, any>;
    await withTenant(p.tenantId, async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: msg.actorId };
      for (const k of ["label", "isRequired", "isUnique", "picklistValues", "sortOrder", "isActive"]) {
        if (p[k] !== undefined) set[k] = p[k];
      }
      await tx.update(fieldDefinitions).set(set)
        .where(and(eq(fieldDefinitions.id, p.id), eq(fieldDefinitions.tenantId, p.tenantId)));
      await enqueue(tx, { topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "metadata", action: "update_field", resourceType: "field_definition", resourceId: p.id, outcome: "success" } });
    });
  });
  q.subscribe(COMMANDS.FIELD_DELETE, async (msg) => {
    const p = msg.payload as Record<string, any>;
    await withTenant(p.tenantId, async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.update(fieldDefinitions)
        .set({ isActive: false, updatedAt: new Date(), updatedBy: msg.actorId })
        .where(and(eq(fieldDefinitions.id, p.id), eq(fieldDefinitions.tenantId, p.tenantId)));
      await enqueue(tx, { topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "metadata", action: "delete_field", resourceType: "field_definition", resourceId: p.id, outcome: "success" } });
    });
  });
}
