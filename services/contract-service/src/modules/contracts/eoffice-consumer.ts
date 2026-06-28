import type { Queue } from "@civitasone/queue";
import { parseDecisionCallback } from "@civitasone/eoffice-sdk";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * Closes the eOffice decision loop for contract awards.
 *
 * When a contract award is raised into eOffice for administrative approval,
 * estab-service emits `contract.award.file_decided` (source_ref_type
 * "contract_award") once the approval chain concludes. This consumer applies
 * that decision to the contract:
 *   approved → status "approved" (award signed; + contract.contract.approved event)
 *   rejected → status "terminated"
 *   returned → audit only (left for revision)
 *
 * Without this, the file was approved in eOffice but the contract never moved —
 * the integration loop was open.
 */
export function registerEOfficeDecisionConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.awardFileDecided, async (msg) => {
    const parsed = parseDecisionCallback(msg.payload);
    if (!parsed.ok) {
      // Malformed callback — drop (the envelope/audit trail records the miss).
      return;
    }
    const cb = parsed.value;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const contract = await repo.findContractByIdTx(tx, cb.refId);
      if (!contract || contract.tenantId !== msg.tenantId) return; // not ours / unknown
      // Only act on a contract still awaiting the eOffice award decision.
      if (contract.status !== "pending_approval" && contract.status !== "draft") return;

      if (cb.decision === "approved") {
        await repo.updateContract(tx, cb.refId, {
          status: "approved", updatedBy: cb.decidedBy, version: (contract.version ?? 1) + 1,
        });
        await enqueue(tx, {
          topic: EVENTS.contractApproved, eventType: EVENTS.contractApproved,
          tenantId: msg.tenantId, actorId: cb.decidedBy, correlationId: msg.correlationId,
          payload: { contractId: cb.refId, approvedBy: cb.decidedBy },
        });
        await audit(tx, msg, "eoffice_approved", cb.refId, { fileNo: cb.fileNo, dscHash: cb.dscHash ?? null });
      } else if (cb.decision === "rejected") {
        await repo.updateContract(tx, cb.refId, {
          status: "terminated", updatedBy: cb.decidedBy, version: (contract.version ?? 1) + 1,
        });
        await audit(tx, msg, "eoffice_rejected", cb.refId, { fileNo: cb.fileNo });
      } else {
        // "returned" — leave as-is for revision (no state change needed).
        await audit(tx, msg, "eoffice_returned", cb.refId, { fileNo: cb.fileNo });
      }
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "contract", cb.refId));
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
    payload: { service: "contract", action, resourceType: "contract", resourceId, outcome: "success", metadata },
  });
}
