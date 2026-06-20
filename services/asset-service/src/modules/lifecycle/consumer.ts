import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as registerRepo from "../register/repo.js";
import { computeDisposalGainLoss, assertAssetTransferable, assertAssetDisposable } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";
const GL_TOPIC    = "finance.gl.post";

export function registerLifecycleConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.assetTransfer, async (msg) => {
    const p = msg.payload as {
      id: string; assetId: string; tenantId: string;
      fromLocation: string; toLocation: string; transferDate: string; notes?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const asset = await registerRepo.findAssetById(p.assetId);
      if (asset) assertAssetTransferable(asset.status);
      await repo.insertTransfer(tx, {
        id: p.id, tenantId: p.tenantId, assetId: p.assetId,
        fromLocation: p.fromLocation, toLocation: p.toLocation, transferDate: p.transferDate,
        notes: p.notes ?? null, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await registerRepo.updateAssetLocation(tx, p.assetId, p.toLocation, msg.actorId);
      await enqueue(tx, {
        topic: EVENTS.assetTransferred, eventType: EVENTS.assetTransferred,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { assetId: p.assetId, fromLocation: p.fromLocation, toLocation: p.toLocation },
      });
      await audit(tx, msg, "transfer", "asset", p.assetId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "asset", p.assetId));
  });

  queue.subscribe(COMMANDS.assetDispose, async (msg) => {
    const p = msg.payload as {
      id: string; assetId: string; tenantId: string;
      disposalDate: string; disposalMethod: string;
      proceedsMinor: number; currency: string; notes?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const asset = await registerRepo.findAssetById(p.assetId);
      if (asset) assertAssetDisposable(asset.status);
      const gainLoss = computeDisposalGainLoss(
        BigInt(p.proceedsMinor),
        asset?.bookValue ?? 0n
      );
      await repo.insertDisposal(tx, {
        id: p.id, tenantId: p.tenantId, assetId: p.assetId,
        disposalDate: p.disposalDate, disposalMethod: p.disposalMethod,
        proceedsMinor: BigInt(p.proceedsMinor), currency: p.currency,
        gainLossMinor: gainLoss,
        notes: p.notes ?? null, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await registerRepo.updateAssetStatus(tx, p.assetId, "disposed", msg.actorId);
      await enqueue(tx, {
        topic: GL_TOPIC, eventType: GL_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          assetId: p.assetId,
          acquisitionCost: asset?.acquisitionCost?.toString() ?? "0",
          accumulatedDep:  asset?.accumulatedDep?.toString()  ?? "0",
          proceeds:        p.proceedsMinor,
          gainLoss:        gainLoss.toString(),
          currency:        p.currency,
          type:            "asset_disposal",
        },
      });
      await enqueue(tx, {
        topic: EVENTS.assetDisposed, eventType: EVENTS.assetDisposed,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { assetId: p.assetId, gainLossMinor: gainLoss.toString() },
      });
      await audit(tx, msg, "dispose", "asset", p.assetId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "asset", p.assetId));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "asset", action, resourceType, resourceId, outcome: "success" },
  });
}
