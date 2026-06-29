import type { Queue } from "@civitasone/queue";
import { parseDecisionCallback } from "@civitasone/eoffice-sdk";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as appRepo from "../application/repo.js";
import * as schemeRepo from "../scheme/repo.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * Closes the eOffice decision loop for grant disbursements.
 *
 * When a disbursement is raised into eOffice for administrative approval
 * (source_ref_type "grant_disbursement"), eOffice emits
 * `grant.disbursement.file_decided` once the approval chain concludes. This
 * consumer applies that decision to the disbursement:
 *   approved → emit the EFT payout (approval BEFORE payment — R14), mark the
 *              installment disbursed, and move the disbursement to "initiated".
 *              Guarded by `eft_emitted` so a disbursement is paid at most once
 *              (a legacy already-paid disbursement is only re-stated, not re-paid).
 *   rejected → release the reserved scheme budget (only if it was never paid)
 *              and move the disbursement to "cancelled".
 *   returned → no state change (left in pending_approval for revision)
 *
 * Without this, the file was approved in eOffice but the disbursement never
 * paid — the integration loop was open.
 */
export function registerEOfficeDecisionConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.disbursementFileDecided, async (msg) => {
    const parsed = parseDecisionCallback(msg.payload);
    if (!parsed.ok) {
      // Malformed callback — drop (the envelope/audit trail records the miss).
      return;
    }
    const cb = parsed.value;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const disbursement = await repo.findDisbursementByIdTx(tx, cb.refId, msg.tenantId);
      if (!disbursement) return; // not ours / unknown
      // Only act on a disbursement still awaiting the eOffice decision.
      if (disbursement.status !== "pending_approval") return;

      if (cb.decision === "approved") {
        // R14: emit the payout NOW (approval precedes payment). Guard on
        // eft_emitted so an already-paid (legacy) disbursement is never re-paid.
        if (!disbursement.eftEmitted) {
          await enqueue(tx, {
            topic: "finance.payment.eft.initiate", eventType: "finance.payment.eft.initiate",
            tenantId: msg.tenantId, actorId: cb.decidedBy, correlationId: msg.correlationId,
            payload: {
              disbursementId: disbursement.id, installmentId: disbursement.installmentId,
              amountMinor: disbursement.amountMinor.toString(), currency: disbursement.currency,
              pfmsTxnId: disbursement.pfmsTxnId, mode: disbursement.mode,
              beneficiaryBankRef: disbursement.beneficiaryBankRef ?? undefined,
            },
          });
          await repo.updateInstallment(tx, disbursement.installmentId, { status: "disbursed", updatedBy: cb.decidedBy });
        }
        await repo.updateDisbursement(tx, cb.refId, { status: "initiated", eftEmitted: true, updatedBy: cb.decidedBy });
        await audit(tx, msg, "eoffice_approved", cb.refId, { fileNo: cb.fileNo, paid: !disbursement.eftEmitted, dscHash: cb.dscHash ?? null });
      } else if (cb.decision === "rejected") {
        // Release the scheme budget reserved at initiation — but only if the
        // disbursement was never paid (a paid disbursement's funds are gone).
        if (!disbursement.eftEmitted) {
          const installment = await repo.findInstallmentByIdTx(tx, disbursement.installmentId, msg.tenantId);
          const app = installment ? await appRepo.findApplicationByIdTx(tx, installment.applicationId, msg.tenantId) : null;
          if (app?.schemeId) {
            await schemeRepo.releaseSchemeBudget(tx, app.schemeId, msg.tenantId, disbursement.amountMinor);
          }
        }
        await repo.updateDisbursement(tx, cb.refId, { status: "cancelled", updatedBy: cb.decidedBy });
        await audit(tx, msg, "eoffice_rejected", cb.refId, { fileNo: cb.fileNo, budgetReleased: !disbursement.eftEmitted });
      } else {
        // "returned" — leave as pending_approval for revision (no state change needed).
        await audit(tx, msg, "eoffice_returned", cb.refId, { fileNo: cb.fileNo });
      }
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "disbursement", cb.refId));
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
    payload: { service: "grant", action, resourceType: "grant_disbursement", resourceId, outcome: "success", metadata },
  });
}
