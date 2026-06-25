import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerCounselBriefConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.counselBriefAssign, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; caseId: string; hearingId?: string;
      counselName: string; counselType?: string; briefSummary: string;
      feeMinor?: number; currency?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertBrief(tx, {
        id: p.id, tenantId: p.tenantId, caseId: p.caseId, hearingId: p.hearingId ?? null,
        counselName: p.counselName, counselType: p.counselType ?? "advocate",
        briefSummary: p.briefSummary, feeMinor: BigInt(p.feeMinor ?? 0),
        currency: p.currency ?? "INR", status: "assigned",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.counselBriefAssigned, eventType: EVENTS.counselBriefAssigned,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { briefId: p.id, caseId: p.caseId, counselName: p.counselName },
      });
      await audit(tx, msg, "assign", "counsel_brief", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "counsel_brief", p.id));
  });
}

async function audit(tx: any, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "legal", action, resourceType, resourceId, outcome: "success" },
  });
}
