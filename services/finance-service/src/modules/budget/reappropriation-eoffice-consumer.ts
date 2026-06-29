import type { Queue } from "@civitasone/queue";
import { parseDecisionCallback } from "@civitasone/eoffice-sdk";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * D7 (re-appropriation) — closes the eOffice decision loop for budget
 * re-appropriations.
 *
 * When a re-appropriation request was raised into eOffice for administrative
 * approval, eOffice emits `finance.reappropriation.file_decided` once the
 * SO→US→DS chain concludes. This consumer applies that decision:
 *   approved → execute the zero-sum transfer (debit source head savings, credit
 *              target head) via transferBudgetReMinorGuarded; if the source no
 *              longer has enough savings the request is rejected instead
 *   rejected → status "rejected"
 *   returned → no state change
 *
 * Tenant-guarded; only acts while the request is still `pending_approval`.
 * Mirrors budget/eoffice-consumer.ts (sanctions) and payments/eoffice-consumer.ts.
 */
export function registerReappropriationEOfficeDecisionConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.reappropriationFileDecided, async (msg) => {
    const parsed = parseDecisionCallback(msg.payload);
    if (!parsed.ok) {
      // Malformed callback — drop (the envelope/audit trail records the miss).
      return;
    }
    const cb = parsed.value;

    let affectedBudgetId: string | null = null;
    let affectedFromId: string | null = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const req = await repo.findReappropriationByIdTx(tx, cb.refId);
      if (!req || req.tenantId !== msg.tenantId) return; // not ours / unknown
      // Only act on a request still awaiting the eOffice decision.
      if (req.status !== "pending_approval") return;

      if (cb.decision === "approved") {
        // Apply the zero-sum transfer (GFR Rule 10): debit the source head's
        // savings and credit the target head, conserving total appropriation.
        // Re-validated at execution time — savings may have changed since the
        // file was raised, so an over-committed source is rejected here.
        if (!req.fromBudgetId) {
          await repo.updateReappropriation(tx, cb.refId, { status: "rejected", updatedBy: cb.decidedBy });
          await audit(tx, msg, "eoffice_rejected_no_source", cb.refId, { fileNo: cb.fileNo });
          return;
        }
        const moved = await repo.transferBudgetReMinorGuarded(
          tx, req.fromBudgetId, req.budgetId, req.amountMinor, req.tenantId, cb.decidedBy,
        );
        if (moved) {
          await repo.updateReappropriation(tx, cb.refId, { status: "approved", updatedBy: cb.decidedBy });
          affectedBudgetId = req.budgetId;
          affectedFromId = req.fromBudgetId;
          await audit(tx, msg, "eoffice_approved", cb.refId, {
            fileNo: cb.fileNo, fromBudgetId: req.fromBudgetId, toBudgetId: req.budgetId,
            amountMinor: req.amountMinor.toString(), dscHash: cb.dscHash ?? null,
          });
        } else {
          // Source no longer has enough savings — the approval cannot create
          // funds, so the request is rejected rather than silently applied.
          await repo.updateReappropriation(tx, cb.refId, { status: "rejected", updatedBy: cb.decidedBy });
          await audit(tx, msg, "eoffice_rejected_insufficient_savings", cb.refId, {
            fileNo: cb.fileNo, fromBudgetId: req.fromBudgetId, amountMinor: req.amountMinor.toString(),
          });
        }
      } else if (cb.decision === "rejected") {
        await repo.updateReappropriation(tx, cb.refId, { status: "rejected", updatedBy: cb.decidedBy });
        await audit(tx, msg, "eoffice_rejected", cb.refId, { fileNo: cb.fileNo });
      } else {
        // "returned" — leave as pending for revision (no state change needed).
        await audit(tx, msg, "eoffice_returned", cb.refId, { fileNo: cb.fileNo });
      }
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "reappropriation", cb.refId));
    if (affectedBudgetId) {
      await cache.invalidate(cache.makeKey(msg.tenantId, "budget", affectedBudgetId));
    }
    if (affectedFromId) {
      await cache.invalidate(cache.makeKey(msg.tenantId, "budget", affectedFromId));
    }
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
    payload: { service: "finance", action, resourceType: "reappropriation", resourceId, outcome: "success", metadata },
  });
}
