import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerOrgHierarchyConsumers(q: Queue): void {
  q.subscribe("tenant.org_unit.create", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; name: string; type: string; parentId?: string; headUserId?: string; code?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Calculate level from parent
      let level = 1;
      if (p.parentId) {
        const parent = await repo.findById(p.tenantId, p.parentId);
        if (parent) level = parent.level + 1;
      }
      await repo.insertOrgUnit(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name, type: p.type,
        parentId: p.parentId ?? null, headUserId: p.headUserId ?? null,
        code: p.code ?? null, level, createdBy: msg.actorId, version: 1,
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "tenant", action: "create_org_unit", resourceType: "org_unit", resourceId: p.id, outcome: "success" } });
    });
  });

  q.subscribe("tenant.org_unit.update", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; name?: string; type?: string; parentId?: string; headUserId?: string; code?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateOrgUnit(tx, p.id, p.tenantId, {
        ...(p.name ? { name: p.name } : {}),
        ...(p.type ? { type: p.type } : {}),
        ...(p.parentId !== undefined ? { parentId: p.parentId } : {}),
        ...(p.headUserId !== undefined ? { headUserId: p.headUserId } : {}),
        ...(p.code !== undefined ? { code: p.code } : {}),
      });
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "tenant", action: "update_org_unit", resourceType: "org_unit", resourceId: p.id, outcome: "success" } });
    });
  });
}
