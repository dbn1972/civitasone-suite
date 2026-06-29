import type { Queue } from "@civitasone/queue";
import { parseDecisionCallback } from "@civitasone/eoffice-sdk";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import { assertMajorPenaltyInquiry } from "./state-machine.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * Closes the eOffice decision loop for HR disciplinary cases.
 *
 * When a proposed penalty is submitted for approval (see commands.ts
 * `submitDisciplinaryForApproval`), the case is moved to `pending_approval`
 * with the proposed penalty recorded, and an eFile is raised into eOffice
 * (source_ref_type "hr_disciplinary"). Once the approval chain concludes,
 * estab-service emits `hrms.disciplinary.file_decided` and this consumer
 * applies the decision:
 *   approved → impose the penalty: move the case pending_approval → penalty_imposed.
 *   rejected → drop the case (closed, no action): pending_approval → dropped.
 *   returned → leave the case pending for revision (audit only).
 *
 * Mirrors modules/lifecycle/eoffice-consumer.ts (transfer). Tenant-guarded and
 * status-guarded: only a case still awaiting the decision is acted upon.
 */
export function registerDisciplinaryEOfficeConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.disciplinaryFileDecided, async (msg) => {
    const parsed = parseDecisionCallback(msg.payload);
    if (!parsed.ok) {
      // Malformed callback — drop (the envelope/audit trail records the miss).
      return;
    }
    const cb = parsed.value;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      if (cb.decision === "approved") {
        // R19 — CCS (CCA) Rule 14: a MAJOR penalty cannot be imposed on a single
        // eOffice approval. The formal inquiry must be complete (charge memo
        // served, inquiry officer appointed, finding recorded). Verify at the
        // imposition gate regardless of how the case reached pending_approval.
        const existing = await repo.findCaseTx(tx, msg.tenantId, cb.refId);
        if (!existing || existing.status !== "pending_approval") return; // not ours / already decided
        const rule14 = assertMajorPenaltyInquiry({
          proceedingType: existing.proceedingType,
          penaltyType: existing.penaltyType,
          chargeMemoRef: existing.chargeMemoRef,
          inquiryOfficerId: existing.inquiryOfficerId,
          finding: existing.finding,
          findingDate: existing.findingDate,
        });
        if (!rule14.ok) {
          // Block imposition: the case stays pending_approval; record the reason.
          await repo.appendEvent(tx, {
            tenantId: msg.tenantId, caseId: cb.refId, fromStatus: "pending_approval",
            toStatus: "pending_approval", action: "major_penalty_blocked_rule14",
            notes: rule14.reason ?? "Rule 14 inquiry incomplete", actorId: cb.decidedBy,
          });
          await audit(tx, msg, "eoffice_blocked_rule14", cb.refId, {
            fileNo: cb.fileNo, reason: rule14.reason ?? null, penaltyType: existing.penaltyType,
          });
          return;
        }
        const row = await repo.transitionCase(tx, msg.tenantId, cb.refId, cb.decidedBy, {
          from: ["pending_approval"], to: "penalty_imposed",
        });
        if (!row) return; // not ours / already decided
        await repo.appendEvent(tx, {
          tenantId: msg.tenantId, caseId: cb.refId, fromStatus: "pending_approval",
          toStatus: "penalty_imposed", action: "impose_penalty",
          notes: `eOffice approved (file ${cb.fileNo})`, actorId: cb.decidedBy,
        });
        await audit(tx, msg, "eoffice_approved", cb.refId, {
          fileNo: cb.fileNo, penaltyType: row.penaltyType, dscHash: cb.dscHash ?? null,
        });
      } else if (cb.decision === "rejected") {
        const row = await repo.transitionCase(tx, msg.tenantId, cb.refId, cb.decidedBy, {
          from: ["pending_approval"], to: "dropped", set: { closedAt: new Date() },
        });
        if (!row) return;
        await repo.appendEvent(tx, {
          tenantId: msg.tenantId, caseId: cb.refId, fromStatus: "pending_approval",
          toStatus: "dropped", action: "drop",
          notes: `eOffice rejected (file ${cb.fileNo})`, actorId: cb.decidedBy,
        });
        await audit(tx, msg, "eoffice_rejected", cb.refId, { fileNo: cb.fileNo });
      } else {
        // "returned" — leave the case pending for revision (no state change).
        await audit(tx, msg, "eoffice_returned", cb.refId, { fileNo: cb.fileNo });
      }
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "disciplinary_case", cb.refId));
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
    payload: { service: "hrms", action, resourceType: "disciplinary_case", resourceId, outcome: "success", metadata },
  });
}
