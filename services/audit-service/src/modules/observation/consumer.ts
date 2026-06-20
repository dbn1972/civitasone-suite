import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, CONSUME_TOPICS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = CONSUME_TOPICS.auditEventRecord;

export function registerObservationConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.observationCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; obsNo: string; planId?: string; auditeeRef: string;
      finding: string; category?: string; riskLevel?: string; amountInvolvedMinor?: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertObservation(tx, {
        id: p.id, tenantId: p.tenantId, obsNo: p.obsNo, planId: p.planId ?? null,
        auditeeRef: p.auditeeRef, finding: p.finding, category: p.category ?? "compliance",
        riskLevel: p.riskLevel ?? "medium", amountInvolvedMinor: BigInt(p.amountInvolvedMinor ?? 0),
        status: "open", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "observation", p.id);
    });
  });
}

async function audit(tx: any, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "audit", action, resourceType, resourceId, outcome: "success" },
  });
}
