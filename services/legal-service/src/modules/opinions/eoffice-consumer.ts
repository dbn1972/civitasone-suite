import type { Queue } from "@civitasone/queue";
import { parseDecisionCallback } from "@civitasone/eoffice-sdk";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * Closes the eOffice decision loop for legal opinions.
 *
 * When an opinion is raised into eOffice for administrative approval (source
 * ref type "legal_opinion"), eOffice emits `legal.opinion.file_decided` once the
 * approval chain concludes. This consumer applies that decision to the opinion:
 *   approved → status "issued"   (+ legal.opinion.issued event)
 *   rejected → status "rejected"
 *   returned → audit only (leave the opinion for revision)
 *
 * Without this, the file was approved in eOffice but the opinion never moved —
 * the integration loop was open.
 */
export function registerOpinionEOfficeDecisionConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.opinionFileDecided, async (msg) => {
    const parsed = parseDecisionCallback(msg.payload);
    if (!parsed.ok) {
      // Malformed callback — drop (the envelope/audit trail records the miss).
      return;
    }
    const cb = parsed.value;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const opinion = await repo.findOpinionByIdTx(tx, cb.refId);
      if (!opinion || opinion.tenantId !== msg.tenantId) return; // not ours / unknown
      // Only act while the opinion is still awaiting the eOffice decision.
      if (opinion.status !== "pending_approval" && opinion.status !== "drafted") return;

      if (cb.decision === "approved") {
        await repo.updateOpinion(tx, cb.refId, {
          status: "issued", issuedAt: new Date(),
          updatedBy: cb.decidedBy, version: (opinion.version ?? 1) + 1,
        });
        await enqueue(tx, {
          topic: EVENTS.opinionIssued, eventType: EVENTS.opinionIssued,
          tenantId: msg.tenantId, actorId: cb.decidedBy, correlationId: msg.correlationId,
          payload: { opinionId: cb.refId, opinionNo: opinion.opinionNo, caseId: opinion.caseId, subject: opinion.subject },
        });
        await audit(tx, msg, "eoffice_approved", cb.refId, { fileNo: cb.fileNo, dscHash: cb.dscHash ?? null });
      } else if (cb.decision === "rejected") {
        await repo.updateOpinion(tx, cb.refId, {
          status: "rejected", updatedBy: cb.decidedBy, version: (opinion.version ?? 1) + 1,
        });
        await audit(tx, msg, "eoffice_rejected", cb.refId, { fileNo: cb.fileNo });
      } else {
        // "returned" — leave for revision (no state change needed).
        await audit(tx, msg, "eoffice_returned", cb.refId, { fileNo: cb.fileNo });
      }
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "opinion", cb.refId));
  });
}

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "legal", action, resourceType: "legal_opinion", resourceId, outcome: "success", metadata },
  });
}
