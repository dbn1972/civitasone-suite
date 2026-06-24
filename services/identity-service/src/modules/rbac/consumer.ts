import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { roleAssignmentHistory } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

async function emitAudit(
  tx: unknown, msg: CommandEnvelope, eventType: string,
  payload: Record<string, unknown>, action: string, resourceType: string, resourceId: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "identity", action, resourceType, resourceId, outcome: "success" },
  });
}

export function registerRbacConsumers(q: Queue): void {
  q.subscribe<{ id: string; key: string; name: string; description?: string }>(COMMANDS.rbacCreateRole, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insertRole(tx, {
        id: p.id, tenantId: msg.tenantId, key: p.key, name: p.name,
        description: p.description ?? null, createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
      });
      await emitAudit(tx, msg, EVENTS.rbacRoleCreated, { roleId: p.id, key: p.key }, "create", "rbac_role", p.id);
    });
  });

  q.subscribe<{ id: string; key: string; name: string; description?: string }>(COMMANDS.rbacCreatePermission, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insertPermission(tx, {
        id: p.id, tenantId: msg.tenantId, key: p.key, name: p.name,
        description: p.description ?? null, createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
      });
      await emitAudit(tx, msg, EVENTS.rbacPermissionCreated, { permissionId: p.id, key: p.key }, "create", "rbac_permission", p.id);
    });
  });

  q.subscribe<{ roleId: string; permissionId: string; permissionKey: string }>(COMMANDS.rbacGrantPermission, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      // Idempotent: skip if already attached.
      if (await repo.roleHasPermission(tx, msg.tenantId, p.roleId, p.permissionId)) return;
      await repo.attachPermission(tx, msg.tenantId, p.roleId, p.permissionId, msg.actorId);
      await emitAudit(tx, msg, EVENTS.rbacPermissionGranted, { roleId: p.roleId, permissionId: p.permissionId }, "grant", "rbac_role", p.roleId);
    });
  });

  q.subscribe<{ roleId: string; permissionId: string }>(COMMANDS.rbacRevokePermission, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.detachPermission(tx, msg.tenantId, p.roleId, p.permissionId);
      await emitAudit(tx, msg, EVENTS.rbacPermissionRevoked, { roleId: p.roleId, permissionId: p.permissionId }, "revoke", "rbac_role", p.roleId);
    });
  });

  q.subscribe<{ roleId: string; userId: string; reason?: string }>(COMMANDS.rbacAssignRole, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const cur = await repo.findAssignment(tx, msg.tenantId, p.roleId, p.userId);
      if (cur) {
        if (cur.status === "active") return; // idempotent
        const n = await repo.setAssignmentStatus(tx, msg.tenantId, cur.id, "active", cur.version, msg.actorId);
        if (n === 0) throw new Error("optimistic lock conflict on role assignment reactivation");
      } else {
        await repo.insertAssignment(tx, msg.tenantId, p.roleId, p.userId, msg.actorId);
      }
      await tx.insert(roleAssignmentHistory).values({
        tenantId: msg.tenantId, roleId: p.roleId, userId: p.userId, action: "assign",
        actorId: msg.actorId, reason: p.reason ?? null,
      });
      await emitAudit(tx, msg, EVENTS.rbacRoleAssigned, { roleId: p.roleId, userId: p.userId }, "assign", "rbac_role_assignment", p.userId);
    });
  });

  q.subscribe<{ roleId: string; userId: string; reason?: string }>(COMMANDS.rbacRevokeRole, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const cur = await repo.findAssignment(tx, msg.tenantId, p.roleId, p.userId);
      if (!cur || cur.status !== "active") return; // idempotent / nothing to revoke
      const n = await repo.setAssignmentStatus(tx, msg.tenantId, cur.id, "revoked", cur.version, msg.actorId);
      if (n === 0) throw new Error("optimistic lock conflict on role revoke");
      await tx.insert(roleAssignmentHistory).values({
        tenantId: msg.tenantId, roleId: p.roleId, userId: p.userId, action: "revoke",
        actorId: msg.actorId, reason: p.reason ?? null,
      });
      await emitAudit(tx, msg, EVENTS.rbacRoleRevoked, { roleId: p.roleId, userId: p.userId }, "revoke", "rbac_role_assignment", p.userId);
    });
  });
}
