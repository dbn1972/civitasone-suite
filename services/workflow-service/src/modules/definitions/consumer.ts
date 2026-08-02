import type { CommandEnvelope, Queue } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { subscribeWithDlq } from "../dlq/wrap.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { definitions, definitionEdges, definitionNodes } from "./schema.js";
import * as repo from "./repo.js";
import { validateGraph } from "./graph.js";

const AUDIT_TOPIC = "audit.event.record";
type Payload = Record<string, unknown> & { id: string; tenantId: string };

async function emit(tx: Parameters<typeof enqueue>[0], msg: CommandEnvelope, topic: string, action: string, resourceId: string): Promise<void> {
  await enqueue(tx, { topic, eventType: topic, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { definitionId: resourceId } });
  await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow", action, resourceType: "definition", resourceId, outcome: "success" } });
}

export function registerDefinitionConsumers(queue: Queue): void {
  queue = tenantScoped(queue);
  subscribeWithDlq<Payload>(queue, COMMANDS.createDefinition, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const latest = await repo.findLatestVersionTx(tx, p.tenantId, p.code as string);
      await tx.insert(definitions).values({ id: p.id, tenantId: p.tenantId, code: p.code as string, name: p.name as string, description: p.description as string | undefined, layout: p.layout as never, version: (latest?.version ?? 0) + 1, status: "draft", createdBy: msg.actorId, updatedBy: msg.actorId });
      await repo.insertGraphTx(tx, p.id, p.nodes as never, p.edges as never);
      await emit(tx, msg, EVENTS.definitionCreated, "create", p.id);
    });
  });
  subscribeWithDlq<Payload>(queue, COMMANDS.deployDefinition, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const rows = await tx.select().from(definitions).where(and(eq(definitions.id, p.id), eq(definitions.tenantId, p.tenantId))).limit(1);
      const current = rows[0]; if (!current || current.status === "active") return;
      const [nodes, edges] = await Promise.all([
        tx.select().from(definitionNodes).where(eq(definitionNodes.definitionId, p.id)),
        tx.select().from(definitionEdges).where(eq(definitionEdges.definitionId, p.id)),
      ]);
      if (!validateGraph(nodes.map((n) => ({ ...n, nodeKey: n.nodeKey })), edges).valid) return;
      await tx.update(definitions).set({ status: "active", updatedAt: new Date(), updatedBy: msg.actorId }).where(eq(definitions.id, p.id));
      await repo.archiveOtherVersionsTx(tx, p.tenantId, current.code, p.id);
      await emit(tx, msg, EVENTS.definitionDeployed, "deploy", p.id);
    });
  });
  subscribeWithDlq<Payload>(queue, COMMANDS.cloneDefinitionTemplate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const templateRows = await tx.select().from(definitions).where(and(eq(definitions.id, p.templateId as string), eq(definitions.isTemplate, true))).limit(1);
      const template = templateRows[0]; if (!template) return;
      const latest = await repo.findLatestVersionTx(tx, p.tenantId, p.code as string);
      await tx.insert(definitions).values({ id: p.id, tenantId: p.tenantId, code: p.code as string, name: p.name as string, description: template.description ?? undefined, version: (latest?.version ?? 0) + 1, status: "draft", isTemplate: false, createdBy: msg.actorId, updatedBy: msg.actorId });
      const [nodes, edges] = await Promise.all([
        tx.select().from(definitionNodes).where(eq(definitionNodes.definitionId, template.id)),
        tx.select().from(definitionEdges).where(eq(definitionEdges.definitionId, template.id)),
      ]);
      await repo.insertGraphTx(tx, p.id, nodes, edges);
      await emit(tx, msg, EVENTS.definitionCloned, "clone", p.id);
    });
  });
  subscribeWithDlq<Payload>(queue, COMMANDS.rollbackDefinition, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload; const target = await repo.rollbackToVersionTx(tx, p.tenantId, p.code as string, p.version as number, msg.actorId);
      if (target) await emit(tx, msg, EVENTS.definitionRolledBack, "rollback", target.id);
    });
  });
  subscribeWithDlq<Payload>(queue, COMMANDS.importBpmnDefinition, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload; const latest = await repo.findLatestVersionTx(tx, p.tenantId, p.code as string);
      await tx.insert(definitions).values({ id: p.id, tenantId: p.tenantId, code: p.code as string, name: p.name as string, version: (latest?.version ?? 0) + 1, status: "draft", createdBy: msg.actorId, updatedBy: msg.actorId });
      await repo.insertGraphTx(tx, p.id, p.nodes as never, p.edges as never);
      await emit(tx, msg, EVENTS.definitionBpmnImported, "bpmn_import", p.id);
    });
  });
}
