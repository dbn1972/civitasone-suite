import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { parseDecisionCallback } from "@civitasone/eoffice-sdk";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as registerRepo from "../register/repo.js";
import { computeDisposalGainLoss, assertAssetDisposable } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";
const GL_TOPIC    = "finance.gl.post";

/**
 * Closes the eOffice decision loop for asset disposals.
 *
 * When a disposal is submitted for administrative approval it is staged as a
 * pending disposal (workflow_status "pending"). eOffice emits
 * `asset.disposal.file_decided` once the approval chain concludes; this
 * consumer applies that decision:
 *   approved → effect the disposal per the existing domain (write the
 *              asset_disposals record, move the asset to "disposed", post the
 *              disposal GL journal, emit asset.disposed) and mark the pending
 *              row "approved".
 *   rejected → mark the pending row "cancelled" (asset is left untouched).
 *   returned → audit only (the file is sent back for revision).
 *
 * Without this, the file was approved in eOffice but the asset was never
 * disposed — the integration loop was open.
 */
export function registerDisposalEOfficeDecisionConsumers(rawQueue: Queue): void {
  // #146 regression fix: run every handler inside the message tenant context so
  // NOBYPASSRLS + FORCE RLS accepts consumer writes (telephony PR #152 pattern).
  const queue = tenantScoped(rawQueue);
  queue.subscribe(CONSUMED_EVENTS.disposalFileDecided, async (msg) => {
    const parsed = parseDecisionCallback(msg.payload);
    if (!parsed.ok) {
      // Malformed callback — drop (the envelope/audit trail records the miss).
      return;
    }
    const cb = parsed.value;

    let assetIdToInvalidate: string | null = null;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const pending = await repo.findPendingDisposalByIdTx(tx, cb.refId);
      if (!pending || pending.tenantId !== msg.tenantId) return; // not ours / unknown
      // Only act on a disposal still awaiting the eOffice decision.
      if (pending.workflowStatus !== "pending") return;
      assetIdToInvalidate = pending.assetId;

      if (cb.decision === "approved") {
        const asset = await registerRepo.findAssetById(pending.assetId, msg.tenantId);
        // Asset vanished / cross-tenant — cannot effect the disposal. Cancel the
        // staged row so the loop is not left open and record the miss.
        if (!asset) {
          await repo.updatePendingDisposalStatus(tx, pending.id, msg.tenantId, "cancelled");
          await audit(tx, msg, "eoffice_approved_uneffectable", pending.assetId, { fileNo: cb.fileNo, pendingDisposalId: pending.id });
          return;
        }
        assertAssetDisposable(asset.status);
        const gainLoss = computeDisposalGainLoss(pending.proceedsMinor, asset.bookValue);
        await repo.insertDisposal(tx, {
          id: randomUUID(), tenantId: pending.tenantId, assetId: pending.assetId,
          disposalDate: pending.disposalDate, disposalMethod: pending.disposalMethod,
          proceedsMinor: pending.proceedsMinor, currency: pending.currency,
          gainLossMinor: gainLoss,
          notes: pending.notes ?? null, createdBy: cb.decidedBy, updatedBy: cb.decidedBy,
        });
        await registerRepo.updateAssetStatus(tx, pending.assetId, msg.tenantId, "disposed", cb.decidedBy);
        await enqueue(tx, {
          topic: GL_TOPIC, eventType: GL_TOPIC,
          tenantId: msg.tenantId, actorId: cb.decidedBy, correlationId: msg.correlationId,
          payload: {
            assetId: pending.assetId,
            acquisitionCost: asset.acquisitionCost.toString(),
            accumulatedDep:  asset.accumulatedDep.toString(),
            proceeds:        Number(pending.proceedsMinor),
            gainLoss:        gainLoss.toString(),
            currency:        pending.currency,
            type:            "asset_disposal",
          },
        });
        await enqueue(tx, {
          topic: EVENTS.assetDisposed, eventType: EVENTS.assetDisposed,
          tenantId: msg.tenantId, actorId: cb.decidedBy, correlationId: msg.correlationId,
          payload: { assetId: pending.assetId, gainLossMinor: gainLoss.toString() },
        });
        await repo.updatePendingDisposalStatus(tx, pending.id, msg.tenantId, "approved");
        await audit(tx, msg, "eoffice_approved", pending.assetId, { fileNo: cb.fileNo, dscHash: cb.dscHash ?? null, pendingDisposalId: pending.id });
      } else if (cb.decision === "rejected") {
        await repo.updatePendingDisposalStatus(tx, pending.id, msg.tenantId, "cancelled");
        await audit(tx, msg, "eoffice_rejected", pending.assetId, { fileNo: cb.fileNo, pendingDisposalId: pending.id });
      } else {
        // "returned" — leave staged as pending for revision (no state change).
        await audit(tx, msg, "eoffice_returned", pending.assetId, { fileNo: cb.fileNo, pendingDisposalId: pending.id });
      }
    });

    if (assetIdToInvalidate) {
      await cache.invalidate(cache.makeKey(msg.tenantId, "asset", assetIdToInvalidate));
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
    payload: { service: "asset", action, resourceType: "asset_disposal", resourceId, outcome: "success", metadata },
  });
}
