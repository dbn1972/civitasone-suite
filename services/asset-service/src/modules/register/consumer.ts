import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, CONSUMED, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerRegisterConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.assetCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name: string; code: string; categoryId: string;
      acquisitionCost: number; salvageValue?: number; usefulLifeYears?: number;
      depRate?: number; depMethod?: string; currency?: string;
      acquisitionDate: string; poRef?: string; grnRef?: string; location?: string; notes?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const costMinor = BigInt(p.acquisitionCost);
      await repo.insertAsset(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name, code: p.code,
        categoryId: p.categoryId, status: "active",
        acquisitionCost: costMinor, salvageValue: BigInt(p.salvageValue ?? 0),
        usefulLifeYears: p.usefulLifeYears ?? 5,
        depRate: String(p.depRate ?? 20), depMethod: p.depMethod ?? "SLM",
        currency: p.currency ?? "INR",
        bookValue: costMinor, accumulatedDep: 0n,
        acquisitionDate: p.acquisitionDate,
        poRef: p.poRef ?? null, grnRef: p.grnRef ?? null,
        location: p.location ?? null, notes: p.notes ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.assetCreated, eventType: EVENTS.assetCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { assetId: p.id, code: p.code, acquisitionCost: p.acquisitionCost },
      });
      await audit(tx, msg, "create", "asset", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "asset", p.id));
    await cache.invalidateResource(msg.tenantId, "asset");
  });

  // Triggered by procurement.grn.accepted for fixed-asset GRN items
  queue.subscribe(CONSUMED.grnAccepted, async (msg) => {
    const p = msg.payload as {
      grnId: string; poRef: string; vendorId: string;
      items?: Array<{ itemCode: string; itemName: string; acceptedQty: number; rateMinor: number; currency?: string; itemType?: string }>;
    };
    const fixedAssetItems = (p.items ?? []).filter((i) => i.itemType === "fixed_asset");
    for (const item of fixedAssetItems) {
      const assetId = randomUUID();
      const msgId = randomUUID();
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, `${msg.messageId}:${item.itemCode}`))) return;
        await repo.insertAsset(tx, {
          id: assetId, tenantId: msg.tenantId,
          name: item.itemName, code: item.itemCode,
          categoryId: "00000000-0000-4000-8000-000000000000",
          status: "active",
          acquisitionCost: BigInt(item.rateMinor),
          salvageValue: 0n,
          usefulLifeYears: 5,
          depRate: "20",
          depMethod: "SLM",
          currency: item.currency ?? "INR",
          bookValue: BigInt(item.rateMinor),
          accumulatedDep: 0n,
          acquisitionDate: new Date().toISOString().slice(0, 10),
          poRef: p.poRef,
          grnRef: `procurement_grn:${p.grnId}`,
          location: null, notes: null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "create_from_grn", "asset", assetId);
      });
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
