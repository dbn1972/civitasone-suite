/**
 * positions consumers (CAP-014/015). Handlers run inside runWithTenant so
 * FORCED RLS accepts writes. Position creation validates the referenced
 * org_unit is in-tenant; role mapping validates the position exists in-tenant.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import * as repo from "./repo.js";
import { findByIdTx as findOrgUnitTx } from "../org-hierarchy/repo.js";

const AUDIT_TOPIC = "audit.event.record";
const log = pino({ name: "positions-consumer" });
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function registerPositionConsumers(q: Queue): void {
  q.subscribe("tenant.position.create", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; orgUnitId?: string; code: string; title: string; grade?: string; sanctionedStrength?: number };
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      if (p.orgUnitId) {
        const unit = await findOrgUnitTx(tx as never, p.tenantId, p.orgUnitId);
        if (!unit) { log.warn({ orgUnitId: p.orgUnitId }, "position.create: org_unit not in tenant"); return; }
      }
      await repo.insertPosition(tx, {
        id: p.id, tenantId: p.tenantId, orgUnitId: p.orgUnitId ?? null, code: p.code, title: p.title,
        grade: p.grade ?? null, sanctionedStrength: p.sanctionedStrength ?? 1, createdBy: msg.actorId,
      });
      await audit(tx, msg, "create_position", "position", p.id);
    }));
  });

  q.subscribe("tenant.position_role.map", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; positionId: string; roleKey: string };
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      if (!(await repo.findPositionTx(tx, p.tenantId, p.positionId))) { log.warn({ positionId: p.positionId }, "role.map: position missing"); return; }
      await repo.insertRole(tx, { id: p.id, tenantId: p.tenantId, positionId: p.positionId, roleKey: p.roleKey, createdBy: msg.actorId });
      await audit(tx, msg, "map_position_role", "position_role", p.id);
    }));
  });
}

async function audit(tx: Tx, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "tenant", action, resourceType, resourceId, outcome: "success" } });
}
