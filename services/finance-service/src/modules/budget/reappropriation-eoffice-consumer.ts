import type { Queue } from "@civitasone/queue";
import { parseDecisionCallback } from "@civitasone/eoffice-sdk";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import { assertReleaseWithinSanction } from "./domain.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * D7 (re-appropriation) — closes the eOffice decision loop for budget
 * re-appropriations.
 *
 * When a re-appropriation request was raised into eOffice for administrative
 * approval, eOffice emits `finance.reappropriation.file_decided` once the
 * SO→US→DS chain concludes. This consumer applies that decision:
 *   approved → status "approved" AND apply the re-appropriation (set the target
 *              budget's re_minor to the requested amount — same effect the
 *              direct `reappropriateBudget` path produces, so approval actually
 *              executes the change)
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
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const req = await repo.findReappropriationByIdTx(tx, cb.refId);
      if (!req || req.tenantId !== msg.tenantId) return; // not ours / unknown
      // Only act on a request still awaiting the eOffice decision.
      if (req.status !== "pending_approval") return;

      if (cb.decision === "approved") {
        // Apply the re-appropriation: set the target budget's revised estimate
        // to the requested amount, enforcing GFR Rule 11 (RE <= BE) just like
        // the direct re_appropriate consumer path.
        const budget = await repo.findBudgetById(req.budgetId);
        if (budget) {
          assertReleaseWithinSanction(budget.beMinor, req.amountMinor);
          await repo.updateBudget(tx, req.budgetId, { reMinor: req.amountMinor, updatedBy: cb.decidedBy });
          affectedBudgetId = req.budgetId;
        }
        await repo.updateReappropriation(tx, cb.refId, { status: "approved", updatedBy: cb.decidedBy });
        await audit(tx, msg, "eoffice_approved", cb.refId, { fileNo: cb.fileNo, budgetId: req.budgetId, amountMinor: req.amountMinor.toString(), dscHash: cb.dscHash ?? null });
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
