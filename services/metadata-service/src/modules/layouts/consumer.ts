import type { Queue } from "@civitasone/queue";
import { eq, and } from "drizzle-orm";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { withTenant } from "../../shared/scope.js";
import { COMMANDS } from "../../topics.js";
import { layoutDefinitions } from "../entities/schema.js";

export function registerLayoutConsumers(q: Queue): void {
  q.subscribe(COMMANDS.LAYOUT_CREATE, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; entityId: string; layoutType: string;
      sections: unknown; isDefault: boolean;
    };
    await withTenant(p.tenantId, async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(layoutDefinitions).values({
        id: p.id, tenantId: p.tenantId, entityDefId: p.entityId,
        layoutType: p.layoutType, sections: p.sections, isDefault: p.isDefault,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "metadata", action: "create_layout", resourceType: "layout_definition", resourceId: p.id, outcome: "success" },
      });
    });
  });

  q.subscribe(COMMANDS.LAYOUT_UPDATE, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; sections?: unknown; isDefault?: boolean;
    };
    await withTenant(p.tenantId, async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const set: Record<string, unknown> = { updatedAt: new Date(), updatedBy: msg.actorId };
      if (p.sections !== undefined) set.sections = p.sections;
      if (p.isDefault !== undefined) set.isDefault = p.isDefault;
      await tx.update(layoutDefinitions).set(set)
        .where(and(eq(layoutDefinitions.id, p.id), eq(layoutDefinitions.tenantId, p.tenantId)));
      await enqueue(tx, {
        topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "metadata", action: "update_layout", resourceType: "layout_definition", resourceId: p.id, outcome: "success" },
      });
    });
  });
}
