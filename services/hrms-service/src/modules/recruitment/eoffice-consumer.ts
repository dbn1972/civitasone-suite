import type { Queue } from "@civitasone/queue";
import { parseDecisionCallback } from "@civitasone/eoffice-sdk";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * Closes the eOffice decision loop for HR recruitment (job openings).
 *
 * When a recruitment requisition is raised into eOffice for administrative
 * approval (source_ref_type "hr_recruitment"), estab-service emits
 * `hrms.recruitment.file_decided` once the approval chain concludes. This
 * consumer applies the decision:
 *   approved → mark the job opening "approved" (ready to publish / accept apps).
 *   rejected → mark the job opening "rejected" (cancelled).
 *   returned → leave in pending state for revision (audit only).
 *
 * Without this, the file was approved in eOffice but the recruitment never
 * moved — the integration loop was open.
 */
export function registerRecruitmentEOfficeConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.recruitmentFileDecided, async (msg) => {
    const parsed = parseDecisionCallback(msg.payload);
    if (!parsed.ok) {
      // Malformed callback — drop (the envelope/audit trail records the miss).
      return;
    }
    const cb = parsed.value;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const job = await repo.findJobOpeningByIdTx(tx, cb.refId, msg.tenantId);
      if (!job) return; // not ours / unknown
      // Only act on a job opening still awaiting the eOffice decision.
      if (job.status !== "pending_approval") return;

      if (cb.decision === "approved") {
        await repo.updateJobOpening(tx, cb.refId, { status: "approved", updatedBy: cb.decidedBy });
        await audit(tx, msg, "eoffice_approved", cb.refId, {
          fileNo: cb.fileNo, refNo: job.refNo, dscHash: cb.dscHash ?? null,
        });
      } else if (cb.decision === "rejected") {
        await repo.updateJobOpening(tx, cb.refId, { status: "rejected", updatedBy: cb.decidedBy });
        await audit(tx, msg, "eoffice_rejected", cb.refId, { fileNo: cb.fileNo, refNo: job.refNo });
      } else {
        // "returned" — leave the request pending for revision (no state change).
        await audit(tx, msg, "eoffice_returned", cb.refId, { fileNo: cb.fileNo });
      }
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "job_opening", cb.refId));
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
    payload: { service: "hrms", action, resourceType: "recruitment", resourceId, outcome: "success", metadata },
  });
}
