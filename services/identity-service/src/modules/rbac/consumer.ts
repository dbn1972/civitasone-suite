import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { roleAssignmentHistory } from "./schema.js";
import { assertCanConfer, assertKeyAllowed, DomainError } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * SEC C1 — record an apply-time authority rejection. The grant/assign passed
 * the request-path check but the caller's authority was revoked (or the role's
 * permission set changed) before apply, so we refuse to apply it and emit a
 * failure audit. We do NOT throw: the rejection is a permanent decision, so the
 * message is consumed (not retried/dead-lettered) — only the privileged write
 * is suppressed.
 */
async function emitRejectionAudit(
  tx: unknown, msg: CommandEnvelope, action: string, resourceType: string, resourceId: string, reason: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "identity", action, resourceType, resourceId, outcome: "denied", reason, severity: "high" },
  });
}

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

  q.subscribe<{ roleId: string; permissionId: string; permissionKey: string; callerRoles?: string[] }>(COMMANDS.rbacGrantPermission, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      // Idempotent: skip if already attached.
      if (await repo.roleHasPermission(tx, msg.tenantId, p.roleId, p.permissionId)) return;

      // SEC C1: re-run the authority check at APPLY time under a row lock. The
      // request-path check is advisory only; authority may have been revoked
      // between request and apply. We lock the target role, re-derive the
      // caller's effective DB permissions, and re-validate against the
      // permission being conferred. Reserved-key conferral is re-validated too.
      const lockedRole = await repo.lockRole(tx, msg.tenantId, p.roleId);
      if (!lockedRole) {
        await emitRejectionAudit(tx, msg, "grant", "rbac_role", p.roleId, "role no longer exists");
        return;
      }
      const callerRoles = p.callerRoles ?? [];
      try {
        assertKeyAllowed(callerRoles, [p.permissionKey]);
        const callerPerms = await repo.effectivePermissionKeys(tx, msg.tenantId, msg.actorId);
        assertCanConfer(callerRoles, callerPerms, [p.permissionKey]);
      } catch (err) {
        if (err instanceof DomainError) {
          await emitRejectionAudit(tx, msg, "grant", "rbac_role", p.roleId, `authority re-check failed at apply: ${err.message}`);
          return; // consume; do not apply, do not retry
        }
        throw err;
      }

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

  q.subscribe<{ roleId: string; userId: string; reason?: string; callerRoles?: string[] }>(COMMANDS.rbacAssignRole, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;

      // SEC C1: apply-time authority re-check under a row lock. Lock the target
      // role so its permission set cannot change concurrently, re-derive the
      // role's permission keys + the caller's effective permissions, and confirm
      // the caller may still confer everything the role grants.
      const lockedRole = await repo.lockRole(tx, msg.tenantId, p.roleId);
      if (!lockedRole) {
        await emitRejectionAudit(tx, msg, "assign", "rbac_role_assignment", p.userId, "role no longer exists");
        return;
      }
      const callerRoles = p.callerRoles ?? [];
      try {
        const rolePerms = await repo.permissionKeysForRole(tx, msg.tenantId, p.roleId);
        const callerPerms = await repo.effectivePermissionKeys(tx, msg.tenantId, msg.actorId);
        assertCanConfer(callerRoles, callerPerms, rolePerms);
      } catch (err) {
        if (err instanceof DomainError) {
          await emitRejectionAudit(tx, msg, "assign", "rbac_role_assignment", p.userId, `authority re-check failed at apply: ${err.message}`);
          return;
        }
        throw err;
      }

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
