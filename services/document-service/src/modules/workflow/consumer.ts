import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed, stableUuid } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";
type TxParam = Parameters<typeof enqueue>[0];

async function auditSuccess(tx: TxParam, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string, details: Record<string, unknown>): Promise<void> {
  await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "document", action, resourceType, resourceId, outcome: "success", details } });
}

/** A command rejected at consume time (stale holder, self-approval, already decided) is audited as denied, never dropped silently. */
async function auditDenied(tx: TxParam, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string, reason: string): Promise<void> {
  await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "document", action, resourceType, resourceId, outcome: "denied", details: { reason } } });
}

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

  queue.subscribe<{ dakId: string; assignedTo: string; asAdmin?: boolean; remarks?: string }>(COMMANDS.dakForward, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Re-check the current holder at consume time; a stale holder's command is dropped.
      if (!(await repo.forwardDak(tx, msg.tenantId, msg.payload.dakId, msg.payload.assignedTo, msg.actorId, msg.payload.asAdmin === true))) {
        await auditDenied(tx as TxParam, msg, "forward", "dak", msg.payload.dakId, "not_current_holder");
        return;
      }
      // #125: forwarding remarks go on the dak's note sheet as a noting by the forwarder (deterministic id: redelivery-safe).
      const remarks = msg.payload.remarks?.trim();
      const notingId = remarks ? stableUuid("dak-forward-remarks:" + msg.messageId) : null;
      if (remarks && notingId) await repo.insertNoting(tx, { id: notingId, tenantId: msg.tenantId, dakId: msg.payload.dakId, body: remarks, createdBy: msg.actorId });
      await enqueue(tx as TxParam, { topic: EVENTS.dakForwarded, eventType: EVENTS.dakForwarded, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { dakId: msg.payload.dakId } });
      await auditSuccess(tx as TxParam, msg, "forward", "dak", msg.payload.dakId, { assignedTo: msg.payload.assignedTo, hasRemarks: notingId !== null, ...(notingId ? { notingId } : {}) });
    });
  });

  queue.subscribe<{ dakId: string; asAdmin?: boolean }>(COMMANDS.dakAcknowledge, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      if (!(await repo.acknowledgeDak(tx, msg.tenantId, msg.payload.dakId, msg.actorId, msg.payload.asAdmin === true))) {
        await auditDenied(tx as TxParam, msg, "acknowledge", "dak", msg.payload.dakId, "not_current_holder");
        return;
      }
      await enqueue(tx as TxParam, { topic: EVENTS.dakAcknowledged, eventType: EVENTS.dakAcknowledged, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { dakId: msg.payload.dakId } });
      await enqueue(tx as TxParam, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "document", action: "acknowledge", resourceType: "dak", resourceId: msg.payload.dakId, outcome: "success" } });
    });
  });

  queue.subscribe<{ id: string; dakId: string; tenantId: string; body: string }>(COMMANDS.notingCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertNoting(tx, { id: msg.payload.id, tenantId: msg.tenantId, dakId: msg.payload.dakId, body: msg.payload.body, createdBy: msg.actorId });
      await auditSuccess(tx as TxParam, msg, "create", "noting", msg.payload.id, { dakId: msg.payload.dakId });
    });
  });

  queue.subscribe<{ dakId: string; approvalId?: string }>(COMMANDS.approvalSubmit, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const id = msg.payload.approvalId ?? msg.messageId;
      await repo.insertApproval(tx, { id, tenantId: msg.tenantId, dakId: msg.payload.dakId, status: "pending", createdBy: msg.actorId });
      await auditSuccess(tx as TxParam, msg, "submit", "approval", id, { dakId: msg.payload.dakId });
    });
  });

  queue.subscribe<{ approvalId: string; decision: string; remarks?: string; asAdmin?: boolean }>(COMMANDS.approvalDecide, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      if (!(await repo.decideApproval(tx, msg.tenantId, msg.payload.approvalId, msg.payload.decision, msg.payload.remarks ?? null, msg.actorId, msg.payload.asAdmin === true))) {
        await auditDenied(tx as TxParam, msg, "decide", "approval", msg.payload.approvalId, "not_pending_or_not_holder_or_self_approval");
        return;
      }
      await auditSuccess(tx as TxParam, msg, "decide", "approval", msg.payload.approvalId, { decision: msg.payload.decision });
    });
  });
}
