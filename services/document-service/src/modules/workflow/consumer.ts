import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";
type TxParam = Parameters<typeof enqueue>[0];

export function registerWorkflowConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe<Record<string, unknown>>(COMMANDS.dakCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insertDak(tx, {
        id: String(p.id), tenantId: msg.tenantId,
        subject: String(p.subject), body: p.body != null ? String(p.body) : null,
        fileId: p.fileId != null ? String(p.fileId) : null,
        priority: String(p.priority ?? "normal"),
        assignedTo: p.assignedTo != null ? String(p.assignedTo) : null,
        dueDate: p.dueDate != null ? new Date(String(p.dueDate)) : null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx as TxParam, { topic: EVENTS.dakCreated, eventType: EVENTS.dakCreated, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { dakId: p.id } });
      await enqueue(tx as TxParam, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "document", action: "create", resourceType: "dak", resourceId: String(p.id), outcome: "success" } });
    });
  });

  queue.subscribe<{ dakId: string; assignedTo: string }>(COMMANDS.dakForward, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.forwardDak(tx, msg.tenantId, msg.payload.dakId, msg.payload.assignedTo, msg.actorId);
      await enqueue(tx as TxParam, { topic: EVENTS.dakForwarded, eventType: EVENTS.dakForwarded, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { dakId: msg.payload.dakId } });
    });
  });

  queue.subscribe<{ dakId: string }>(COMMANDS.dakAcknowledge, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.acknowledgeDak(tx, msg.tenantId, msg.payload.dakId, msg.actorId);
      await enqueue(tx as TxParam, { topic: EVENTS.dakAcknowledged, eventType: EVENTS.dakAcknowledged, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { dakId: msg.payload.dakId } });
    });
  });

  queue.subscribe<{ id: string; dakId: string; tenantId: string; body: string }>(COMMANDS.notingCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertNoting(tx, { id: msg.payload.id, tenantId: msg.tenantId, dakId: msg.payload.dakId, body: msg.payload.body, createdBy: msg.actorId });
    });
  });

  queue.subscribe<{ dakId: string }>(COMMANDS.approvalSubmit, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const id = randomUUID();
      await repo.insertApproval(tx, { id, tenantId: msg.tenantId, dakId: msg.payload.dakId, status: "pending", createdBy: msg.actorId });
    });
  });

  queue.subscribe<{ approvalId: string; decision: string; remarks?: string }>(COMMANDS.approvalDecide, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.decideApproval(tx, msg.tenantId, msg.payload.approvalId, msg.payload.decision, msg.payload.remarks ?? null, msg.actorId);
    });
  });
}
