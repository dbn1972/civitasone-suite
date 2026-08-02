import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import * as repo from "./repo.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { subscribeWithDlq } from "../dlq/wrap.js";
import { COMMANDS, EVENTS } from "../../topics.js";

export function registerDecisionConsumers(queue: Queue): void {
  queue = tenantScoped(queue);
  subscribeWithDlq<Record<string, unknown> & { id: string; tenantId: string }>(queue, COMMANDS.createDecision, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insertDecisionTable(tx, { id: p.id, tenantId: p.tenantId, code: p.code as string, name: p.name as string, hitPolicy: p.hitPolicy as never, inputs: p.inputs as never, outputs: p.outputs as never, rules: p.rules as never, createdBy: msg.actorId, updatedBy: msg.actorId });
      await enqueue(tx, { topic: EVENTS.decisionCreated, eventType: EVENTS.decisionCreated, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { decisionId: p.id } });
      await enqueue(tx, { topic: "audit.event.record", eventType: "audit.event.record", tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow", action: "create_decision", resourceType: "decision", resourceId: p.id, outcome: "success" } });
    });
  });
  subscribeWithDlq<{ id: string; tenantId: string }>(queue, COMMANDS.deployDecision, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.findById(msg.payload.id, msg.payload.tenantId);
      if (!row || row.status === "active") return;
      await repo.deployVersion(tx, msg.payload.id, msg.payload.tenantId, msg.actorId);
      await enqueue(tx, { topic: EVENTS.decisionDeployed, eventType: EVENTS.decisionDeployed, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { decisionId: msg.payload.id } });
      await enqueue(tx, { topic: "audit.event.record", eventType: "audit.event.record", tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow", action: "deploy_decision", resourceType: "decision", resourceId: msg.payload.id, outcome: "success" } });
    });
  });
}
