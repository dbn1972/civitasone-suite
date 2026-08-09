import type { Queue } from "@civitasone/queue";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { withTenant } from "../../shared/scope.js";
import { entityDefinitions } from "./schema.js";
import { eq, and } from "drizzle-orm";
import { tenantScoped } from "../../shared/tenant-queue.js";

export function registerEntityConsumers(q: Queue): void {
  const queue = tenantScoped(rawQueue);
  q.subscribe("metadata.entity.create", async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      apiName: string;
      label: string;
      pluralLabel: string;
      description?: string;
      icon?: string;
    };
    // Domain tables are FORCE RLS — consumer must set app.tenant_id (withTenant)
    // or the insert is invisible/rejected and the message retries forever.
    await withTenant(p.tenantId, async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(entityDefinitions).values({
        id: p.id,
        tenantId: p.tenantId,
        apiName: p.apiName,
        label: p.label,
        pluralLabel: p.pluralLabel,
        description: p.description ?? null,
        icon: p.icon ?? "cube",
        isActive: true,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "metadata",
          action: "create_entity",
          resourceType: "entity_definition",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
  });

  q.subscribe("metadata.entity.update", async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      label?: string;
      pluralLabel?: string;
      description?: string;
      isActive?: boolean;
    };
    await withTenant(p.tenantId, async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: msg.actorId };
      if (p.label !== undefined) set.label = p.label;
      if (p.pluralLabel !== undefined) set.pluralLabel = p.pluralLabel;
      if (p.description !== undefined) set.description = p.description;
      if (p.isActive !== undefined) set.isActive = p.isActive;
      await tx
        .update(entityDefinitions)
        .set(set)
        .where(and(eq(entityDefinitions.id, p.id), eq(entityDefinitions.tenantId, p.tenantId)));
      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "metadata",
          action: "update_entity",
          resourceType: "entity_definition",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
  });

  q.subscribe("metadata.entity.publish", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await withTenant(p.tenantId, async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.update(entityDefinitions)
        .set({ publishedAt: new Date(), publishedBy: msg.actorId, isActive: true, updatedAt: new Date(), updatedBy: msg.actorId })
        .where(and(eq(entityDefinitions.id, p.id), eq(entityDefinitions.tenantId, p.tenantId)));
      await enqueue(tx, {
        topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "metadata", action: "publish_entity", resourceType: "entity_definition", resourceId: p.id, outcome: "success" },
      });
    });
  });
}
