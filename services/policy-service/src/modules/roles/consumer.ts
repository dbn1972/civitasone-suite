import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerRoleConsumers(q: Queue): void {
  q.subscribe<{ id: string; tenantId: string; name: string; description: string | null }>(
    COMMANDS.createRole, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await repo.insertRole(tx, { id: p.id, tenantId: p.tenantId, name: p.name, description: p.description ?? null, status: "active", createdBy: msg.actorId, updatedBy: msg.actorId, version: 1 });
        await emitAudit(tx, msg, EVENTS.roleCreated, { roleId: p.id }, "create", p.id);
      });
    }
  );

  q.subscribe<{ id: string; name?: string; description?: string }>(COMMANDS.updateRole, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cur = await repo.findRoleByIdTx(tx, msg.payload.id);
      if (!cur) throw new Error(`role ${msg.payload.id} not found`);
      const patch: Record<string, unknown> = { updatedBy: msg.actorId, version: cur.version + 1 };
      if (msg.payload.name !== undefined) patch.name = msg.payload.name;
      if (msg.payload.description !== undefined) patch.description = msg.payload.description;
      await repo.updateRole(tx, msg.payload.id, patch);
      await emitAudit(tx, msg, EVENTS.roleUpdated, { roleId: msg.payload.id }, "update", msg.payload.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE.role, msg.payload.id));
  });

  q.subscribe<{ id: string; roleId: string; tenantId: string; resource: string; action: string; effect: string }>(
    COMMANDS.addPermission, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await repo.insertPermission(tx, { id: p.id, tenantId: p.tenantId, roleId: p.roleId, resource: p.resource, action: p.action, effect: p.effect, createdBy: msg.actorId, updatedBy: msg.actorId, version: 1 });
        await emitAudit(tx, msg, EVENTS.permissionAdded, { roleId: p.roleId, resource: p.resource, action: p.action }, "add_permission", p.id);
      });
    }
  );
}

async function emitAudit(tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>, action: string, resourceId: string): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "policy", action, resourceType: "role", resourceId, outcome: "success" } });
}
