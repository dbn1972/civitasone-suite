import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, CONSUMED, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";
const DEFAULT_IT_CATEGORY = "77777777-0001-0000-0000-000000000001";
const DEFAULT_VEHICLE_CATEGORY = "77777777-0001-0000-0000-000000000002";

function makeBarcode(code: string): string {
  return `AST-${code.replace(/\//g, "-")}`;
}

export function registerRegisterConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.assetCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name: string; code: string; categoryId: string;
      assetType?: string; acquisitionCost: number; salvageValue?: number; usefulLifeYears?: number;
      depRate?: number; depMethod?: string; currency?: string;
      acquisitionDate: string; poRef?: string; grnRef?: string; location?: string; notes?: string;
      barcode?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const costMinor = BigInt(p.acquisitionCost);
      await repo.insertAsset(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name, code: p.code,
        categoryId: p.categoryId, status: "active",
        assetType: p.assetType ?? "other",
        barcode: p.barcode ?? makeBarcode(p.code),
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
      await enqueueDualDepSchedules(tx, msg, p.id, p.tenantId, p.acquisitionDate);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "asset", p.id));
    await cache.invalidateResource(msg.tenantId, "asset");
  });

  queue.subscribe(CONSUMED.grnAccepted, async (msg) => {
    const p = msg.payload as {
      grnId: string; poRef: string; vendorId: string;
      items?: Array<{ itemCode: string; itemName: string; acceptedQty: number; rateMinor: number; currency?: string; itemType?: string }>;
    };
    const fixedAssetItems = (p.items ?? []).filter((i) => i.itemType === "fixed_asset");
    for (const item of fixedAssetItems) {
      const assetId = randomUUID();
      const itemMsgId = randomUUID();
      const totalCost = BigInt(item.rateMinor) * BigInt(item.acceptedQty || 1);
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, itemMsgId))) return;
        await repo.insertAsset(tx, {
          id: assetId, tenantId: msg.tenantId,
          name: item.itemName, code: item.itemCode,
          categoryId: DEFAULT_IT_CATEGORY,
          assetType: "fixed",
          barcode: makeBarcode(item.itemCode),
          status: "active",
          acquisitionCost: totalCost,
          salvageValue: 0n,
          usefulLifeYears: 5,
          depRate: "20",
          depMethod: "SLM",
          currency: item.currency ?? "INR",
          bookValue: totalCost,
          accumulatedDep: 0n,
          acquisitionDate: new Date().toISOString().slice(0, 10),
          poRef: p.poRef,
          grnRef: `procurement_grn:${p.grnId}`,
          location: null, notes: `Auto-capitalized from GRN ${p.grnId}`,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await enqueue(tx, {
          topic: EVENTS.assetCreated, eventType: EVENTS.assetCreated,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { assetId, code: item.itemCode, acquisitionCost: Number(totalCost), grnId: p.grnId },
        });
        await audit(tx, msg, "create_from_grn", "asset", assetId);
        await enqueueDualDepSchedules(tx, msg, assetId, msg.tenantId, new Date().toISOString().slice(0, 10));
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, "asset", assetId));
    }
    if (fixedAssetItems.length) {
      await cache.invalidateResource(msg.tenantId, "asset");
    }
  });
}

export { DEFAULT_VEHICLE_CATEGORY, makeBarcode };

async function enqueueDualDepSchedules(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  assetId: string,
  tenantId: string,
  startDate: string,
): Promise<void> {
  for (const spec of [{ depBook: "company", method: "SLM" }, { depBook: "statutory", method: "WDV" }] as const) {
    await enqueue(tx, {
      topic: COMMANDS.depSchedule, eventType: COMMANDS.depSchedule,
      tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
      payload: { id: randomUUID(), assetId, tenantId, method: spec.method, depBook: spec.depBook, startDate },
    });
  }
}

async function audit(tx: Parameters<typeof enqueue>[0], msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "asset", action, resourceType, resourceId, outcome: "success" },
  });
}
