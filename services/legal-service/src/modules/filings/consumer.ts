import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerFilingConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.filingRecord, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; caseId: string; filingType: string;
      title: string; court: string; filingDate: string; referenceNo?: string; status?: string;
    };
    const status = p.status ?? "filed";
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertFiling(tx, {
        id: p.id, tenantId: p.tenantId, caseId: p.caseId, filingType: p.filingType,
        title: p.title, court: p.court, filingDate: p.filingDate, referenceNo: p.referenceNo ?? null,
        status, filedAt: status === "filed" ? new Date() : null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.filingRecorded, eventType: EVENTS.filingRecorded,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { filingId: p.id, caseId: p.caseId, filingType: p.filingType, status },
      });
      await audit(tx, msg, "record", "legal_filing", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "filing", p.id));
  });
}

async function audit(tx: any, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "legal", action, resourceType, resourceId, outcome: "success" },
  });
}
