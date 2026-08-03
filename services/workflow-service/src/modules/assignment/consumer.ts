import type { CommandEnvelope, Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { subscribeWithDlq } from "../dlq/wrap.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./matrix-repo.js";
const AUDIT_TOPIC = "audit.event.record";
type Payload = Record<string, unknown> & { id: string; tenantId: string };
async function emit(tx: Parameters<typeof enqueue>[0], msg: CommandEnvelope, topic: string, action: string, id: string): Promise<void> {
  await enqueue(tx, { topic, eventType: topic, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { id } });
  await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow", action, resourceType: "assignment", resourceId: id, outcome: "success" } });
}
export function registerAssignmentConsumers(queue: Queue): void {
  queue = tenantScoped(queue);
  subscribeWithDlq<Payload>(queue, COMMANDS.createMatrixRule, async (msg) => { await db.transaction(async (tx) => { if (!(await markProcessed(tx, msg.messageId))) return; const p = msg.payload; await repo.insertMatrixRule(tx, { id: p.id, tenantId: p.tenantId, roleRef: p.roleRef as string, conditionExpr: (p.conditionExpr as string | null) ?? null, userId: p.userId as string, priority: p.priority as number }); await emit(tx, msg, EVENTS.matrixRuleCreated, "create_matrix_rule", p.id); }); });
  subscribeWithDlq<Payload>(queue, COMMANDS.deactivateMatrixRule, async (msg) => { await db.transaction(async (tx) => { if (!(await markProcessed(tx, msg.messageId))) return; const record = await repo.deactivateMatrixRule(tx, msg.payload.id, msg.payload.tenantId); if (record) await emit(tx, msg, EVENTS.matrixRuleDeactivated, "deactivate_matrix_rule", record.id); }); });
  subscribeWithDlq<Payload>(queue, COMMANDS.createSubstitution, async (msg) => { await db.transaction(async (tx) => { if (!(await markProcessed(tx, msg.messageId))) return; const p = msg.payload; await repo.insertSubstitution(tx, { id: p.id, tenantId: p.tenantId, userId: p.userId as string, substituteId: p.substituteId as string, fromDate: p.fromDate as string, toDate: (p.toDate as string | null) ?? null, reason: (p.reason as string | null) ?? null }); await emit(tx, msg, EVENTS.substitutionCreated, "create_substitution", p.id); }); });
  subscribeWithDlq<Payload>(queue, COMMANDS.deactivateSubstitution, async (msg) => { await db.transaction(async (tx) => { if (!(await markProcessed(tx, msg.messageId))) return; const record = await repo.deactivateSubstitution(tx, msg.payload.id, msg.payload.tenantId); if (record) await emit(tx, msg, EVENTS.substitutionDeactivated, "deactivate_substitution", record.id); }); });
}
