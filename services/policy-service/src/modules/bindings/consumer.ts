import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerBindingConsumers(q: Queue): void {
  q.subscribe<{ id: string; tenantId: string; userId: string; roleId: string }>(COMMANDS.createBinding, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insertBinding(tx, { id: p.id, tenantId: p.tenantId, userId: p.userId, roleId: p.roleId, status: "active", createdBy: msg.actorId, updatedBy: msg.actorId, version: 1 });
      await emitAudit(tx, msg, EVENTS.bindingCreated, { userId: p.userId, roleId: p.roleId }, "create", p.id);
    });
  });

  q.subscribe<{ id: string }>(COMMANDS.revokeBinding, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cur = await repo.findBindingByIdTx(tx, msg.payload.id);
      if (!cur) return;
      await repo.revokeBinding(tx, msg.payload.id, msg.actorId, cur.version + 1);
      await emitAudit(tx, msg, EVENTS.bindingRevoked, { bindingId: msg.payload.id }, "revoke", msg.payload.id);
    });
  });

  q.subscribe<{ id: string; tenantId: string; requesterId: string; reason: string; scope: string; grantedUntil: string }>(COMMANDS.requestBreakglass, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insertBreakglass(tx, { id: p.id, tenantId: p.tenantId, requesterId: p.requesterId, reason: p.reason, scope: p.scope, grantedUntil: new Date(p.grantedUntil), status: "pending", createdBy: msg.actorId, updatedBy: msg.actorId, version: 1 });
      await emitAudit(tx, msg, EVENTS.breakglassRequested, { requesterId: p.requesterId, scope: p.scope }, "breakglass_request", p.id);
    });
  });
}

async function emitAudit(tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>, action: string, resourceId: string): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "policy", action, resourceType: "binding", resourceId, outcome: "success" } });
}
