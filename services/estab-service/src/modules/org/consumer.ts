import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "./commands.js";
import { canParent } from "./domain.js";
import * as repo from "./repo.js";
import type { CreateOrgUnitBody, UpdateOrgUnitBody } from "./validators.js";

const AUDIT_TOPIC = "audit.event.record";

function audit(
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string, id: string, metadata: Record<string, unknown> = {},
) {
  return {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "estab", action, resourceType: "org_unit", resourceId: id, outcome: "success" as const, metadata },
  };
}

type CreatePayload = CreateOrgUnitBody & { id: string; tenantId: string };

export function registerOrgConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.orgUnitCreate, async (msg) => {
    const p = msg.payload as CreatePayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // One code per tenant (defence-in-depth alongside the unique index).
      const dupe = await repo.findOrgUnitByCode(p.tenantId, p.code);
      if (dupe) throw new Error(`ORG_CODE_TAKEN: '${p.code}' already exists for this tenant`);

      // Hierarchy validation: a child must hang under a strictly higher level.
      if (p.parentId) {
        const parent = await repo.findOrgUnitByIdTx(tx, p.parentId, p.tenantId);
        if (!parent) throw new Error(`ORG_PARENT_NOT_FOUND: ${p.parentId}`);
        if (!canParent(p.type, parent.type)) {
          throw new Error(`ORG_INVALID_HIERARCHY: a ${p.type} cannot sit under a ${parent.type}`);
        }
      }

      await repo.insertOrgUnit(tx, {
        id: p.id, tenantId: p.tenantId, code: p.code, name: p.name, type: p.type,
        parentId: p.parentId ?? null, headOperatorId: p.headOperatorId ?? null,
        active: true, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, audit(msg, "org_unit.create", p.id, { code: p.code, type: p.type }));
    });
    await cache.invalidate(cache.makeKey(p.tenantId, "org_unit", p.id));
  });

  queue.subscribe(COMMANDS.orgUnitUpdate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; patch: UpdateOrgUnitBody };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cur = await repo.findOrgUnitByIdTx(tx, p.id, p.tenantId);
      if (!cur) return;

      // A re-parent must respect the level rule and must not create a cycle.
      if (p.patch.parentId !== undefined && p.patch.parentId !== null) {
        if (p.patch.parentId === p.id) throw new Error("ORG_CYCLE: a unit cannot be its own parent");
        const parent = await repo.findOrgUnitByIdTx(tx, p.patch.parentId, p.tenantId);
        if (!parent) throw new Error(`ORG_PARENT_NOT_FOUND: ${p.patch.parentId}`);
        if (!canParent(cur.type, parent.type)) {
          throw new Error(`ORG_INVALID_HIERARCHY: a ${cur.type} cannot sit under a ${parent.type}`);
        }
        // Setting cur as an ancestor of itself ⇒ cycle. If the proposed parent's
        // ancestor chain contains cur, reject.
        const parentAncestors = await repo.listAncestors(p.tenantId, p.patch.parentId);
        if (parentAncestors.some((a) => a.id === p.id)) {
          throw new Error("ORG_CYCLE: re-parenting would create a cycle");
        }
      }

      const patch: Parameters<typeof repo.updateOrgUnit>[2] = { updatedBy: msg.actorId, version: cur.version + 1 };
      if (p.patch.name !== undefined) patch.name = p.patch.name;
      if (p.patch.parentId !== undefined) patch.parentId = p.patch.parentId;
      if (p.patch.headOperatorId !== undefined) patch.headOperatorId = p.patch.headOperatorId;
      if (p.patch.active !== undefined) patch.active = p.patch.active;
      await repo.updateOrgUnit(tx, p.id, patch);
      await enqueue(tx, audit(msg, "org_unit.update", p.id));
    });
    await cache.invalidate(cache.makeKey(p.tenantId, "org_unit", p.id));
  });
}
