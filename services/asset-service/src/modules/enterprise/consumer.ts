import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED } from "../../topics.js";
import * as pendingRepo from "./repo.js";
import * as registerRepo from "../register/repo.js";
import { computeDisposalGainLoss } from "../lifecycle/domain.js";
import * as lifecycleRepo from "../lifecycle/repo.js";

const AUDIT_TOPIC = "audit.event.record";
const GL_TOPIC = "finance.gl.post";

export function registerEnterpriseConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED.assetDisposeApproved, async (msg) => {
    const p = msg.payload as { pendingId: string; tenantId: string; approvedBy: string };
    let disposedAssetId: string | undefined;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const pending = await pendingRepo.findPendingDisposal(p.pendingId, p.tenantId);
      if (!pending || pending.workflowStatus === "completed") return;
      const asset = await registerRepo.findAssetById(pending.assetId, p.tenantId);
      if (!asset) return;
      disposedAssetId = pending.assetId;
      const gainLoss = computeDisposalGainLoss(pending.proceedsMinor, asset.bookValue);
      const disposalId = randomUUID();
      await lifecycleRepo.insertDisposal(tx, {
        id: disposalId, tenantId: p.tenantId, assetId: pending.assetId,
        disposalDate: pending.disposalDate, disposalMethod: pending.disposalMethod,
        proceedsMinor: pending.proceedsMinor, currency: pending.currency,
        gainLossMinor: gainLoss, notes: pending.notes ?? "Workflow approved disposal",
        createdBy: p.approvedBy, updatedBy: p.approvedBy,
      });
      await registerRepo.updateAssetStatus(tx, pending.assetId, p.tenantId, "disposed", p.approvedBy);
      await pendingRepo.updatePendingDisposal(tx, pending.id, "completed");
      await enqueue(tx, {
        topic: GL_TOPIC, eventType: GL_TOPIC,
        tenantId: msg.tenantId, actorId: p.approvedBy, correlationId: msg.correlationId,
        payload: {
          assetId: pending.assetId,
          acquisitionCost: asset.acquisitionCost.toString(),
          accumulatedDep: asset.accumulatedDep.toString(),
          proceeds: pending.proceedsMinor.toString(),
          gainLoss: gainLoss.toString(),
          currency: pending.currency,
          type: "asset_disposal",
        },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: p.approvedBy, correlationId: msg.correlationId,
        payload: { service: "asset", action: "workflow_dispose", resourceType: "asset", resourceId: pending.assetId, outcome: "success" },
      });
    });
    if (disposedAssetId) {
      await cache.invalidate(cache.makeKey(msg.tenantId, "asset", disposedAssetId));
      await cache.invalidateResource(msg.tenantId, "asset");
    }
  });
}
