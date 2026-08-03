import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, CONSUMED_EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = CONSUMED_EVENTS.auditEventRecord;

export function registerComplianceConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.checklistCreate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      title: string;
      description: string | null;
      items: string[];
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertChecklist(tx, {
        id: p.id,
        tenantId: p.tenantId,
        title: p.title,
        description: p.description,
        items: p.items,
        completed: false,
        createdBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "audit",
          action: "create",
          resourceType: "compliance_checklist",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
  });

  queue.subscribe(COMMANDS.checklistComplete, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const record = await repo.findChecklistByIdTx(tx, p.id, p.tenantId);
      if (!record || record.completed) return;
      const rows = await repo.completeChecklistVersioned(tx, p.id, p.tenantId, p.version, msg.actorId);
      if (rows !== 1) return;
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "audit",
          action: "complete",
          resourceType: "compliance_checklist",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
  });

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
