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
    // The single-item key above is the only one this consumer used to clear.
    // queries.ts caches listBriefs() results under a separate "counsel_briefs"
    // (plural) resource key per caseId/status combo — nothing invalidated that,
    // so a list read that raced ahead of this consumer (or ran before this
    // brief existed) would cache an incomplete/empty result and keep serving
    // it for up to the default TTL even after this insert commits. Confirmed
    // live: POST /v1/legal/counsel-briefs then an immediate GET
    // /v1/legal/counsel-briefs?caseId=... came back { items: [] } although the
    // row was already committed to Postgres.
    await cache.invalidateResource(msg.tenantId, "counsel_briefs");
  });
}

async function audit(tx: any, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "legal", action, resourceType, resourceId, outcome: "success" },
  });
}
