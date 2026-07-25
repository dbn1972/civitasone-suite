import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { EVENTS, CONSUMED_EVENTS } from "../../topics.js";
import { uuidV5 } from "../../shared/ids.js";
import { makeBarcode } from "./consumer.js";
import * as repo from "./repo.js";

// Category the handed-over public work asset is registered under. Overridable
// per a tenant's chart of asset categories. Defaults to a known-seedable id so
// the insert never trips a category FK.
const WORKS_HANDOVER_CATEGORY =
  process.env.ASSET_WORKS_HANDOVER_CATEGORY ?? "77777777-0001-0000-0000-000000000001";

/**
 * Cross-service consumer: works-service emits `works.asset.handover` when a work
 * is closed as "completion". We register the newly-built public asset here.
 *
 * Idempotency mirrors the GRN capitalization path: the asset id AND the inbox
 * dedupe id are BOTH derived deterministically (uuidV5) from the stable work
 * identity, so a redelivered handover hits the same markProcessed gate and the
 * same asset id — one asset, no duplicates across redeliveries.
 */
export function registerWorksHandoverConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.worksAssetHandover, async (msg) => {
    const p = msg.payload as {
      workId: string;
      tenantId: string;
      name: string;
      code: string;
      acquisitionCostMinor: string | number;
      acquisitionDate: string;
      closureType?: string;
    };

    const handoverKey = `works-handover:${p.workId}`;
    const assetId = uuidV5(handoverKey);
    const dedupeId = uuidV5(`msg:${handoverKey}`);
    const costMinor = BigInt(p.acquisitionCostMinor ?? 0);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, dedupeId))) return;

      await repo.insertAsset(tx, {
        id: assetId,
        tenantId: msg.tenantId,
        name: p.name,
        code: p.code,
        categoryId: WORKS_HANDOVER_CATEGORY,
        status: "active",
        assetType: "infra",
        barcode: makeBarcode(p.code),
        acquisitionCost: costMinor,
        salvageValue: 0n,
        usefulLifeYears: 30,
        depRate: "3.33",
        depMethod: "SLM",
        currency: "INR",
        bookValue: costMinor,
        accumulatedDep: 0n,
        acquisitionDate: p.acquisitionDate,
        poRef: null,
        grnRef: null,
        projectRef: `works:${p.workId}`,
        location: null,
        notes: `Handed over from works-service on completion of work ${p.workId}`,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.assetCreated,
        eventType: EVENTS.assetCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { assetId, code: p.code, workId: p.workId, source: "works_handover" },
      });
    });

    await cache.invalidate(cache.makeKey(msg.tenantId, "asset", assetId));
    await cache.invalidateResource(msg.tenantId, "asset");
  });
}
