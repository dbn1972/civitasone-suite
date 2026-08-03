import type { Queue } from "@civitasone/queue";
import { eq, and } from "drizzle-orm";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { withTenant } from "../../shared/scope.js";
import { COMMANDS } from "../../topics.js";
import { moduleCompositions } from "../entities/schema.js";

export function registerCompositionConsumers(q: Queue): void {
  q.subscribe(COMMANDS.COMPOSITION_CREATE, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; apiName: string; label: string; definition: unknown;
    };
    await withTenant(p.tenantId, async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(moduleCompositions).values({
        id: p.id, tenantId: p.tenantId, apiName: p.apiName, label: p.label,
        definition: p.definition, status: "draft",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "metadata", action: "create_composition", resourceType: "module_composition", resourceId: p.id, outcome: "success" },
      });
    });
  });

  q.subscribe(COMMANDS.COMPOSITION_PUBLISH, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await withTenant(p.tenantId, async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.update(moduleCompositions)
        .set({ status: "published", publishedAt: new Date(), publishedBy: msg.actorId, updatedAt: new Date(), updatedBy: msg.actorId })
        .where(and(eq(moduleCompositions.id, p.id), eq(moduleCompositions.tenantId, p.tenantId)));
      await enqueue(tx, {
        topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "metadata", action: "publish_composition", resourceType: "module_composition", resourceId: p.id, outcome: "success" },
      });
    });
  });
}
