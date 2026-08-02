import type { Queue } from "@civitasone/queue";
import { eq, and } from "drizzle-orm";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { withTenant } from "../../shared/scope.js";
import { COMMANDS } from "../../topics.js";
import { entityDefinitions, validationRules } from "../entities/schema.js";

export function registerRuleConsumers(q: Queue): void {
  q.subscribe(COMMANDS.RULE_CREATE, async (msg) => {
    const p = msg.payload as Record<string, any>;
    await withTenant(p.tenantId, async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const parent = await tx.select().from(entityDefinitions)
        .where(and(eq(entityDefinitions.id, p.entityId), eq(entityDefinitions.tenantId, p.tenantId))).limit(1);
      if (!parent[0]) return;
      await tx.insert(validationRules).values({
        id: p.id, tenantId: p.tenantId, entityDefId: p.entityId, name: p.name,
        expression: p.expression, errorMessage: p.errorMessage, sortOrder: p.sortOrder ?? 0,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, { topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "metadata", action: "create_rule", resourceType: "validation_rule", resourceId: p.id, outcome: "success" } });
    });
  });
  q.subscribe(COMMANDS.RULE_UPDATE, async (msg) => {
    const p = msg.payload as Record<string, any>;
    await withTenant(p.tenantId, async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: msg.actorId };
      for (const k of ["name", "expression", "errorMessage", "isActive", "sortOrder"]) {
        if (p[k] !== undefined) set[k] = p[k];
      }
      await tx.update(validationRules).set(set)
        .where(and(eq(validationRules.id, p.id), eq(validationRules.tenantId, p.tenantId)));
      await enqueue(tx, { topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "metadata", action: "update_rule", resourceType: "validation_rule", resourceId: p.id, outcome: "success" } });
    });
  });
  q.subscribe(COMMANDS.RULE_DELETE, async (msg) => {
    const p = msg.payload as Record<string, any>;
    await withTenant(p.tenantId, async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.update(validationRules)
        .set({ isActive: false, updatedAt: new Date(), updatedBy: msg.actorId })
        .where(and(eq(validationRules.id, p.id), eq(validationRules.tenantId, p.tenantId)));
      await enqueue(tx, { topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "metadata", action: "delete_rule", resourceType: "validation_rule", resourceId: p.id, outcome: "success" } });
    });
  });
}
