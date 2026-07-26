import { randomUUID } from "node:crypto";
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as registerRepo from "../register/repo.js";
import * as verificationRepo from "../verification/repo.js";
import { computeDisposalGainLoss, assertAssetTransferable, assertAssetDisposable } from "./domain.js";

const log = pino({ name: "asset-lifecycle-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const GL_TOPIC    = "finance.gl.post";

export function registerLifecycleConsumers(rawQueue: Queue): void {
  // #146 regression fix: run every handler inside the message tenant context so
  // NOBYPASSRLS + FORCE RLS accepts consumer writes (telephony PR #152 pattern).
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.assetTransfer, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; assetId: string; tenantId: string;
        fromLocation: string; toLocation: string; transferDate: string; notes?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const asset = await registerRepo.findAssetById(p.assetId, p.tenantId);
        if (!asset) throw new Error("ASSET_NOT_FOUND_OR_CROSS_TENANT: cannot transfer a missing or cross-tenant asset");
        assertAssetTransferable(asset.status);
        await repo.insertTransfer(tx, {
          id: p.id, tenantId: p.tenantId, assetId: p.assetId,
          fromLocation: p.fromLocation, toLocation: p.toLocation, transferDate: p.transferDate,
          notes: p.notes ?? null, createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await registerRepo.updateAssetLocation(tx, p.assetId, p.tenantId, p.toLocation, msg.actorId);
        await enqueue(tx, {
          topic: EVENTS.assetTransferred, eventType: EVENTS.assetTransferred,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { assetId: p.assetId, fromLocation: p.fromLocation, toLocation: p.toLocation },
        });
        await audit(tx, msg, "transfer", "asset", p.assetId);
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, "asset", p.assetId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.assetTransfer }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.assetDispose, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; assetId: string; tenantId: string;
        disposalDate: string; disposalMethod: string;
        proceedsMinor: number; currency: string; notes?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const asset = await registerRepo.findAssetById(p.assetId, p.tenantId);
        if (!asset) throw new Error("ASSET_NOT_FOUND_OR_CROSS_TENANT: cannot dispose a missing or cross-tenant asset");
        assertAssetDisposable(asset.status);
        const approval = await verificationRepo.findApprovedWriteoff(p.tenantId, p.assetId);
        if (!approval) {
          throw new Error("COMMITTEE_APPROVAL_REQUIRED: Asset write-off requires committee approval per GFR Rule 173.");
        }
        const gainLoss = computeDisposalGainLoss(
          BigInt(p.proceedsMinor),
          asset.bookValue
        );
        await repo.insertDisposal(tx, {
          id: p.id, tenantId: p.tenantId, assetId: p.assetId,
          disposalDate: p.disposalDate, disposalMethod: p.disposalMethod,
          proceedsMinor: BigInt(p.proceedsMinor), currency: p.currency,
          gainLossMinor: gainLoss,
          notes: p.notes ?? null, createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await registerRepo.updateAssetStatus(tx, p.assetId, p.tenantId, "disposed", msg.actorId);
        await enqueue(tx, {
          topic: GL_TOPIC, eventType: GL_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            assetId: p.assetId,
            acquisitionCost: asset.acquisitionCost.toString(),
            accumulatedDep:  asset.accumulatedDep.toString(),
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
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.assetDispose }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.disposalSubmitApproval, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; assetId: string; tenantId: string;
        disposalDate: string; disposalMethod: string;
        proceedsMinor: number; currency: string; notes?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const asset = await registerRepo.findAssetById(p.assetId, p.tenantId);
        if (!asset) throw new Error("ASSET_NOT_FOUND_OR_CROSS_TENANT: cannot submit a missing or cross-tenant asset for disposal");
        assertAssetDisposable(asset.status);
        const approval = await verificationRepo.findApprovedWriteoff(p.tenantId, p.assetId);
        if (!approval) {
          throw new Error("COMMITTEE_APPROVAL_REQUIRED: Asset write-off requires committee approval per GFR Rule 173.");
        }
        const existing = await repo.findActivePendingDisposal(tx, p.tenantId, p.assetId);
        if (existing) {
          throw new Error("DISPOSAL_ALREADY_PENDING: a disposal for this asset is already awaiting an eOffice decision");
        }
        await repo.insertPendingDisposal(tx, {
          id: p.id, tenantId: p.tenantId, assetId: p.assetId,
          disposalDate: p.disposalDate, disposalMethod: p.disposalMethod,
          proceedsMinor: BigInt(p.proceedsMinor), currency: p.currency,
          notes: p.notes ?? null, workflowStatus: "pending", createdBy: msg.actorId,
        });
        await audit(tx, msg, "submit_for_eoffice_approval", "asset_disposal", p.id);
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, "asset", p.assetId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.disposalSubmitApproval }, "Consumer processing failed");
    }
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "asset", action, resourceType, resourceId, outcome: "success" },
  });
}
