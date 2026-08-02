/**
 * BPMN Visual Designer — CQRS consumer. Applies the create/update/delete/
 * import writes published by commands.ts. Mirrors instances/consumer.ts:
 * inbox-dedup (markProcessed) + tenant-scoped transaction + outbox event
 * emission, all in one commit.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { designerDefinitions, type DesignerNode, type DesignerEdge } from "./schema.js";
import { subscribeWithDlq } from "../dlq/wrap.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

type CreatePayload = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  elements: DesignerNode[];
  edges: DesignerEdge[];
};

type UpdatePayload = {
  id: string;
  tenantId: string;
  expectedVersion: number;
  name?: string;
  description?: string;
  elements?: DesignerNode[];
  edges?: DesignerEdge[];
};

type DeletePayload = { id: string; tenantId: string };

type ImportPayload = {
  id: string;
  tenantId: string;
  elements: DesignerNode[];
  edges: DesignerEdge[];
  processName?: string;
};

export function registerDesignerConsumers(queue: Queue): void {
  // RLS (#146): run every handler inside the message's tenant context so
  // db.transaction() sets the app.tenant_id GUC (workflow_svc is NOBYPASSRLS).
  queue = tenantScoped(queue);

  subscribeWithDlq<CreatePayload>(queue, COMMANDS.createDesignerDefinition, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await tx.insert(designerDefinitions).values({
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        description: p.description ?? null,
        elements: p.elements,
        edges: p.edges,
        status: "draft",
        version: 1,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await emit(tx, msg, EVENTS.designerDefinitionCreated, { definitionId: p.id, name: p.name }, "create", p.id);
    });
  });

  subscribeWithDlq<UpdatePayload>(queue, COMMANDS.updateDesignerDefinition, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const rows = await tx.select().from(designerDefinitions)
        .where(and(eq(designerDefinitions.id, p.id), eq(designerDefinitions.tenantId, p.tenantId))).limit(1);
      const existing = rows[0];
      // Gone or superseded by a later write — the synchronous pre-check in
      // commands.ts is advisory; this row-level re-check is authoritative.
      if (!existing || existing.status === "deleted") return;
      if (existing.version !== p.expectedVersion) return;

      const updateData: Record<string, unknown> = {
        version: existing.version + 1,
        updatedAt: new Date(),
        updatedBy: msg.actorId,
      };
      if (p.name !== undefined) updateData.name = p.name;
      if (p.description !== undefined) updateData.description = p.description;
      if (p.elements !== undefined) updateData.elements = p.elements;
      if (p.edges !== undefined) updateData.edges = p.edges;

      await tx.update(designerDefinitions).set(updateData).where(eq(designerDefinitions.id, p.id));
      await emit(tx, msg, EVENTS.designerDefinitionUpdated, { definitionId: p.id, version: existing.version + 1 }, "update", p.id);
    });
  });

  subscribeWithDlq<DeletePayload>(queue, COMMANDS.deleteDesignerDefinition, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const rows = await tx.select().from(designerDefinitions)
        .where(and(eq(designerDefinitions.id, p.id), eq(designerDefinitions.tenantId, p.tenantId))).limit(1);
      const existing = rows[0];
      if (!existing || existing.status === "deleted") return; // already gone — idempotent no-op

      await tx.update(designerDefinitions)
        .set({ status: "deleted", updatedAt: new Date(), updatedBy: msg.actorId })
        .where(eq(designerDefinitions.id, p.id));
      await emit(tx, msg, EVENTS.designerDefinitionDeleted, { definitionId: p.id }, "delete", p.id);
    });
  });

  subscribeWithDlq<ImportPayload>(queue, COMMANDS.importDesignerDefinition, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const rows = await tx.select().from(designerDefinitions)
        .where(and(eq(designerDefinitions.id, p.id), eq(designerDefinitions.tenantId, p.tenantId))).limit(1);
      const existing = rows[0];
      if (!existing || existing.status === "deleted") return;

      await tx.update(designerDefinitions)
        .set({
          elements: p.elements,
          edges: p.edges,
          version: existing.version + 1,
          updatedAt: new Date(),
          updatedBy: msg.actorId,
        })
        .where(eq(designerDefinitions.id, p.id));
      await emit(tx, msg, EVENTS.designerDefinitionImported, {
        definitionId: p.id,
        processName: p.processName ?? null,
        version: existing.version + 1,
      }, "import", p.id);
    });
  });
}

async function emit(
  tx: unknown,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "workflow", action, resourceType: "designer_definition", resourceId, outcome: "success" },
  });
}
