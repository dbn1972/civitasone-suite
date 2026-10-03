/**
 * org-hierarchy consumers — the only writers of tenant.org_units.
 *
 * Each handler runs inside runWithTenant(msg.tenantId, () => db.transaction(...))
 * so the app.tenant_id GUC is set and FORCED RLS accepts the write, and so the
 * hierarchy-integrity reads (level computation, cycle guard) see the tenant's
 * rows. Idempotent via _inbox.processed. Cycle-creating reparents are rejected
 * (defense-in-depth alongside the synchronous route-level 409).
 *
 * Reparents additionally take a per-tenant advisory lock so that concurrent
 * reparents on multiple worker replicas serialize — without it, "X under Y" and
 * "Y under X" could each pass an independent cycle check under READ COMMITTED
 * and both commit, forming a 2-node cycle.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import * as repo from "./repo.js";
import { isUnitInactive } from "./state.js";

const AUDIT_TOPIC = "audit.event.record";
const log = pino({ name: "org-hierarchy-consumer" });

export function registerOrgHierarchyConsumers(q: Queue): void {
  q.subscribe("tenant.org_unit.create", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; name: string; type: string; parentId?: string; headUserId?: string; code?: string };
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      let level = 1;
      if (p.parentId) {
        // Serialize with deactivate: a unit cannot gain a child while it is being end-dated.
        await repo.lockTenantForReparent(tx, p.tenantId);
        const parent = await repo.findByIdTx(tx, p.tenantId, p.parentId);
        if (!parent) {
          log.warn({ id: p.id, parentId: p.parentId }, "org_unit.create: parent not found — rejecting");
          return; // parent must exist within the tenant; drop silently (idempotent)
        }
        if (isUnitInactive(parent)) {
          log.warn({ id: p.id, parentId: p.parentId }, "org_unit.create: parent is deactivated — rejecting");
          return;
        }
        level = parent.level + 1;
      }
      await repo.insertOrgUnit(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name, type: p.type,
        parentId: p.parentId ?? null, headUserId: p.headUserId ?? null,
        code: p.code ?? null, level, createdBy: msg.actorId, version: 1,
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "tenant", action: "create_org_unit", resourceType: "org_unit", resourceId: p.id, outcome: "success" } });
    }));
  });

  q.subscribe("tenant.org_unit.update", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; name?: string; type?: string; parentId?: string | null; headUserId?: string | null; code?: string | null };
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Reparent path: serialize per-tenant before the cycle check so two
      // concurrent reparents can't each pass the check on a stale snapshot and
      // both commit into a cycle. Transaction-scoped; auto-released at commit.
      const isReparent = p.parentId !== undefined;
      if (isReparent) await repo.lockTenantForReparent(tx, p.tenantId);

      const existing = await repo.findByIdTx(tx, p.tenantId, p.id);
      if (!existing) { log.warn({ id: p.id }, "org_unit.update: not found"); return; }
      if (isUnitInactive(existing)) { log.warn({ id: p.id }, "org_unit.update: unit is deactivated"); return; }

      // Reparent integrity: reject cycles defensively (also enforced at route level).
      let nextLevel: number | undefined;
      if (p.parentId !== undefined) {
        if (p.parentId === null) {
          nextLevel = 1;
        } else {
          if (await repo.wouldCreateCycleTx(tx, p.tenantId, p.id, p.parentId)) {
            log.warn({ id: p.id, parentId: p.parentId }, "org_unit.update: cycle rejected");
            return;
          }
          const parent = await repo.findByIdTx(tx, p.tenantId, p.parentId);
          if (!parent) { log.warn({ id: p.id, parentId: p.parentId }, "org_unit.update: parent missing"); return; }
          if (isUnitInactive(parent)) { log.warn({ id: p.id, parentId: p.parentId }, "org_unit.update: parent is deactivated"); return; }
          nextLevel = parent.level + 1;
        }
      }

      await repo.updateOrgUnit(tx, p.id, p.tenantId, {
        ...(p.name !== undefined ? { name: p.name } : {}),
        ...(p.type !== undefined ? { type: p.type } : {}),
        ...(p.parentId !== undefined ? { parentId: p.parentId } : {}),
        ...(p.headUserId !== undefined ? { headUserId: p.headUserId } : {}),
        ...(p.code !== undefined ? { code: p.code } : {}),
        ...(nextLevel !== undefined ? { level: nextLevel } : {}),
      });
      // Descendants keep `level = ancestor level + depth`: move the whole subtree by the same delta.
      if (nextLevel !== undefined) await repo.shiftDescendantLevels(tx, p.tenantId, p.id, nextLevel - existing.level);
      // A reparent records where the unit came from and went to, so the move is reconstructable from audit.
      const reparentAudit = isReparent
        ? { oldParentId: existing.parentId, newParentId: p.parentId ?? null, oldLevel: existing.level, newLevel: nextLevel }
        : {};
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "tenant", action: "update_org_unit", resourceType: "org_unit", resourceId: p.id, outcome: "success", ...reparentAudit } });
    }));
  });

  // GAP-ADMIN-ORG-03: end-date a unit. The conditional UPDATE is the authority (in force + no in-force child);
  // the audit row records the reason and is written in the same transaction.
  q.subscribe("tenant.org_unit.deactivate", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string; positionsAcknowledged?: boolean };
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.lockTenantForReparent(tx, p.tenantId);
      const closed = await repo.deactivateConditional(tx, p.tenantId, p.id);
      if (!closed) { log.warn({ id: p.id }, "org_unit.deactivate: not applied (missing, already inactive, or has active children)"); return; }
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "tenant", action: "deactivate_org_unit", resourceType: "org_unit", resourceId: p.id, outcome: "success", reason: p.reason, ...(p.positionsAcknowledged ? { positionsAcknowledged: true } : {}) } });
    }));
  });
}
