import type { Queue } from "@civitasone/queue";
import { parseDecisionCallback } from "@civitasone/eoffice-sdk";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * Closes the eOffice decision loop for grant schemes.
 *
 * When a grant scheme is raised into eOffice for administrative approval
 * (source_ref_type "grant_scheme"), estab-service emits
 * `grant.scheme.file_decided` once the approval chain concludes. This
 * consumer applies the decision:
 *   approved → mark the scheme "approved" (ready for applications/disbursements).
 *   rejected → mark the scheme "rejected".
 *   returned → leave in pending state for revision (audit only).
 *
 * Without this, the file was approved in eOffice but the scheme never moved —
 * the integration loop was open.
 */
export function registerSchemeEOfficeConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.schemeFileDecided, async (msg) => {
    const parsed = parseDecisionCallback(msg.payload);
    if (!parsed.ok) {
      // Malformed callback — drop (the envelope/audit trail records the miss).
      return;
    }
    const cb = parsed.value;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const scheme = await repo.findSchemeByIdTx(tx, cb.refId, msg.tenantId);
      if (!scheme) return; // not ours / unknown
      // Only act on a scheme still awaiting the eOffice decision.
      if (scheme.status !== "pending_approval") return;

      if (cb.decision === "approved") {
        await repo.updateScheme(tx, cb.refId, { status: "approved", updatedBy: cb.decidedBy });
        await audit(tx, msg, "eoffice_approved", cb.refId, {
          fileNo: cb.fileNo, code: scheme.code, dscHash: cb.dscHash ?? null,
        });
      } else if (cb.decision === "rejected") {
        await repo.updateScheme(tx, cb.refId, { status: "rejected", updatedBy: cb.decidedBy });
        await audit(tx, msg, "eoffice_rejected", cb.refId, { fileNo: cb.fileNo, code: scheme.code });
      } else {
        // "returned" — leave the scheme pending for revision (no state change).
        await audit(tx, msg, "eoffice_returned", cb.refId, { fileNo: cb.fileNo });
      }
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "scheme", cb.refId));
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
    payload: { service: "grant", action, resourceType: "grant_scheme", resourceId, outcome: "success", metadata },
  });
}
