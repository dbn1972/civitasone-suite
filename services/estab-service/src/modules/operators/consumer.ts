import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { invalidateOperatorCache } from "./eligibility.js";
import type { EnrolOperatorBody, UpdateOperatorBody } from "./validators.js";

const AUDIT_TOPIC = "audit.event.record";

type EnrolPayload = EnrolOperatorBody & { id: string; tenantId: string };
type UpdatePayload = { id: string; tenantId: string; patch: UpdateOperatorBody };

export function registerOperatorConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.operatorEnrol, async (msg) => {
    const p = msg.payload as EnrolPayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertOperator(tx, {
        id: p.id, tenantId: p.tenantId, employeeId: p.employeeId,
        division: p.division, section: p.section ?? null,
        deskRole: p.deskRole, canInitiate: p.canInitiate,
        active: true, assignedBy: msg.actorId,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "estab", action: "operator.enrol", resourceType: "file_operator", resourceId: p.id, outcome: "success", metadata: { employeeId: p.employeeId, division: p.division, deskRole: p.deskRole } },
      });
    });
    await invalidateOperatorCache(p.tenantId, p.employeeId);
  });

  queue.subscribe(COMMANDS.operatorUpdate, async (msg) => {
    const p = msg.payload as UpdatePayload;
    let employeeId: string | null = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cur = await repo.findOperatorById(p.id, p.tenantId);
      if (!cur) return;
      employeeId = cur.employeeId;
      const patch: Parameters<typeof repo.updateOperator>[2] = { updatedBy: msg.actorId, version: cur.version + 1 };
      if (p.patch.division !== undefined) patch.division = p.patch.division;
      if (p.patch.section !== undefined) patch.section = p.patch.section;
      if (p.patch.deskRole !== undefined) patch.deskRole = p.patch.deskRole;
      if (p.patch.canInitiate !== undefined) patch.canInitiate = p.patch.canInitiate;
      if (p.patch.active !== undefined) patch.active = p.patch.active;
      await repo.updateOperator(tx, p.id, patch);
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "estab", action: "operator.update", resourceType: "file_operator", resourceId: p.id, outcome: "success", metadata: { patch: p.patch } },
      });
    });
    if (employeeId) await invalidateOperatorCache(p.tenantId, employeeId);
  });
}
