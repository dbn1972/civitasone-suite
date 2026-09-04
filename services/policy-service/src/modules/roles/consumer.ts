import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import { provisionMunicipalRolesForTenant } from "./municipal-provision.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerRoleConsumers(q: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  q = tenantScoped(q);
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
      const cur = await repo.findRoleByIdTx(tx, msg.payload.id, msg.tenantId);
      if (!cur || cur.tenantId !== msg.tenantId) throw new Error(`UNKNOWN_ROLE: ${msg.payload.id} not found for tenant`);
      const patch: Record<string, unknown> = { updatedBy: msg.actorId, version: cur.version + 1 };
      if (msg.payload.name !== undefined) patch.name = msg.payload.name;
      if (msg.payload.description !== undefined) patch.description = msg.payload.description;
      await repo.updateRole(tx, msg.payload.id, msg.tenantId, patch);
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

  // NOTE: deliberately does NOT call emitAudit() / declare an
  // EVENTS.municipalRolesProvisioned topic. A held branch this was ported
  // from published a domain-specific "policy.municipal_roles.provisioned"
  // event with zero consumers anywhere in the fleet — an orphan event that
  // would have tripped tests/contract/cross-service-events.contract.test.ts's
  // ratchet (no NEW orphan events allowed). Its sibling events in this same
  // file (policy.role.created/updated, policy.permission.added) are already
  // pre-existing tracked orphans in tests/contract/known-defects.json, and
  // neither of cross-service-events.allowlist.ts's two valid
  // PRODUCER_ONLY_ALLOWLIST categories (INFRASTRUCTURE SINK, EXTERNAL
  // CONSUMER) honestly applies — nothing generic or external consumes this
  // topic. Rather than mint a fourth orphan under a stretched justification,
  // this only writes the generic audit-trail record (AUDIT_TOPIC), which is
  // the real "audit log entry" a role-provisioning action needs and which
  // audit-service already consumes.
  q.subscribe<{ tenantId: string }>(COMMANDS.provisionMunicipalRoles, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const result = await provisionMunicipalRolesForTenant(tx, msg.tenantId, msg.actorId);
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "policy",
          action: "provision_municipal_roles",
          resourceType: "tenant",
          resourceId: msg.tenantId,
          outcome: "success",
          ...result,
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE.role, msg.tenantId));
  });
}

async function emitAudit(tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>, action: string, resourceId: string): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "policy", action, resourceType: "role", resourceId, outcome: "success" } });
}
