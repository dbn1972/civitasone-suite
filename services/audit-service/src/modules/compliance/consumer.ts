import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, CONSUME_TOPICS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = CONSUME_TOPICS.auditEventRecord;

export function registerComplianceConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.pendingRegisterCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; paraId: string; deptRef: string;
      // P0-3: carried as string end-to-end to avoid Number() truncation of >2^53 paise.
      amountInvolvedMinor: string | number; dueDate?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertPendingRegister(tx, {
        id: p.id, tenantId: p.tenantId, paraId: p.paraId, deptRef: p.deptRef,
        amountInvolvedMinor: BigInt(p.amountInvolvedMinor), status: "pending",
        dueDate: p.dueDate ?? null, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      // P1-8: the recovery-register liability row must itself be audited.
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "audit", action: "pending_register_create",
          resourceType: "pending_register", resourceId: p.id, outcome: "success",
          newValue: { paraId: p.paraId, deptRef: p.deptRef, amountInvolvedMinor: String(p.amountInvolvedMinor) },
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "pending_register", "pending"));
  });
}
