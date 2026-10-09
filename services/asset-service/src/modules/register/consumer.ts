import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, CONSUMED, EVENTS } from "../../topics.js";
import { uuidV5 } from "../../shared/ids.js";
import * as repo from "./repo.js";
import { postAcquisitionOrDefer } from "../enterprise/postings.js";

const AUDIT_TOPIC = "audit.event.record";

/** Postgres unique_violation (SQLSTATE 23505), directly or wrapped by the driver/ORM. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}
// There are NO default GL accounts. The acquisition journal's heads (fixed asset, GRN clearing / acquisition offset) are
// the tenant's asset_settings; when they are not configured the asset is still saved and its journal is deferred
// (gl_post_status "awaiting_accounts", error ASSET_GL_NOT_CONFIGURED) -- see enterprise/postings.ts.
const DEFAULT_IT_CATEGORY = "77777777-0001-0000-0000-000000000001";
const DEFAULT_VEHICLE_CATEGORY = "77777777-0001-0000-0000-000000000002";

function makeBarcode(code: string): string {
  return `AST-${code.replace(/\//g, "-")}`;
}

export function registerRegisterConsumers(rawQueue: Queue): void {
  // #146 regression fix: run every handler inside the message tenant context so
  // NOBYPASSRLS + FORCE RLS accepts consumer writes (telephony PR #152 pattern).
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.assetCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name: string; code: string; categoryId: string;
      assetType?: string; acquisitionCost: number; salvageValue?: number; usefulLifeYears?: number;
      depRate?: number; depMethod?: string; currency?: string;
      acquisitionDate: string; poRef?: string; grnRef?: string; location?: string; locationId?: string; notes?: string;
      barcode?: string;
    };
    try {
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
        location: p.location ?? null, locationId: p.locationId ?? null, notes: p.notes ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.assetCreated, eventType: EVENTS.assetCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { assetId: p.id, code: p.code, acquisitionCost: p.acquisitionCost },
      });
      await audit(tx, msg, "create", "asset", p.id);
      // A DIRECT asset registration hits the books like a GRN capitalization does: a balanced journal Dr fixed asset /
      // Cr the tenant's acquisition-offset account, with a deterministic id (a redelivered create no-ops in finance).
      // The accounts are the tenant's settings -- if they are not configured the asset is kept and the journal deferred.
      // A zero-cost create has no journal.
      await postAcquisitionOrDefer(tx, msg, { id: p.id, tenantId: msg.tenantId, costMinor, date: p.acquisitionDate }, "direct");
      await enqueueDualDepSchedules(tx, msg, p.id, p.tenantId, p.acquisitionDate);
    });
    } catch (err) {
      // UNIQUE(tenant_id, code): a racing duplicate create is TERMINAL -- ack it
      // (no retry) and leave an audit failure record instead of looping.
      if (!isUniqueViolation(err)) throw err;
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "asset", action: "create_rejected_duplicate_code", resourceType: "asset", resourceId: p.id, outcome: "failure", code: p.code },
        });
      });
      return;
    }
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
      // IDEMPOTENCY FIX: derive BOTH the asset id and the inbox-dedupe id
      // deterministically from the stable event identity (grnId + item line),
      // NOT randomUUID() per delivery. A redelivered procurement.grn.accepted
      // now hits the SAME itemMsgId -> markProcessed gates it (one asset, one
      // GL), and the asset id / acq journal id (uuidV5 acq:${assetId}) are
      // identical across redeliveries. Previously these were random per
      // delivery, so redelivery silently double-capitalized (duplicate asset
      // row + duplicate acquisition GL post).
      const lineKey = `grn-asset:${p.grnId}:${item.itemCode}`;
      const assetId = uuidV5(lineKey);
      const itemMsgId = uuidV5(`msg:${lineKey}`);
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
          payload: { assetId, code: item.itemCode, acquisitionCost: totalCost.toString(), grnId: p.grnId },
        });
        // Acquisition journal on capitalization: a balanced StandardJournal Dr fixed asset / Cr GRN clearing with a
        // deterministic uuidV5 id keyed off the asset (a redelivered GRN hits the journal PK in finance and no-ops).
        // The accounts are the tenant's settings; if they are not configured the asset is kept and the journal deferred.
        const acqDate = new Date().toISOString().slice(0, 10);
        await postAcquisitionOrDefer(tx, msg, { id: assetId, tenantId: msg.tenantId, costMinor: totalCost, date: acqDate }, "grn");
        await audit(tx, msg, "create_from_grn", "asset", assetId);
        await enqueueDualDepSchedules(tx, msg, assetId, msg.tenantId, new Date().toISOString().slice(0, 10));
      });
      await cache.invalidate(cache.makeKey(msg.tenantId, "asset", assetId));
    }
    if (fixedAssetItems.length) {
      await cache.invalidateResource(msg.tenantId, "asset");
    }
  });

  // GAP2-ASSETS-INSURANCE-CLAIMS-02: category master-data on the CQRS path.
  // Validate at the route; the conditional, tenant-scoped write + audit live here.
  queue.subscribe(COMMANDS.assetCategoryCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name: string; code: string;
      depMethod: "SLM" | "WDV"; depRate: number; usefulLifeYears: number;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertCategory(tx, {
          id: p.id, tenantId: p.tenantId, name: p.name, code: p.code,
          depMethod: p.depMethod, depRate: String(p.depRate), usefulLifeYears: p.usefulLifeYears,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "create", "asset_category", p.id);
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        await db.transaction(async (tx) => {
          if (!(await markProcessed(tx, msg.messageId))) return;
          await enqueue(tx, {
            topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
            tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: { service: "asset", action: "create_rejected_duplicate_code", resourceType: "asset_category", resourceId: p.id, outcome: "failure", code: p.code },
          });
        });
        return;
      }
      throw err;
    }
    await cache.invalidateResource(msg.tenantId, "asset_category");
  });

  queue.subscribe(COMMANDS.assetCategoryUpdate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string;
      name?: string; code?: string; depMethod?: "SLM" | "WDV"; depRate?: number; usefulLifeYears?: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const patch: Record<string, unknown> = {};
      if (p.name !== undefined) patch.name = p.name;
      if (p.code !== undefined) patch.code = p.code;
      if (p.depMethod !== undefined) patch.depMethod = p.depMethod;
      if (p.depRate !== undefined) patch.depRate = String(p.depRate);
      if (p.usefulLifeYears !== undefined) patch.usefulLifeYears = p.usefulLifeYears;
      await repo.updateCategory(tx, p.id, p.tenantId, patch, msg.actorId);
      await audit(tx, msg, "update", "asset_category", p.id);
    });
    await cache.invalidateResource(msg.tenantId, "asset_category");
  });

  queue.subscribe(COMMANDS.assetTagBarcode, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; barcode: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateAssetBarcode(tx, p.id, p.tenantId, p.barcode, msg.actorId);
        await audit(tx, msg, "tag_barcode", "asset", p.id);
      });
    } catch (err) {
      // GAP-ASSETS-SCAN-06: two racing tags of the same barcode -- the loser hits
      // uq_asset_assets_tenant_barcode. Its transaction (and inbox row) rolled back; the barcode
      // stays with the winner, and retrying could never succeed, so the command is dropped -- but never silently:
      // the refusal is recorded as an audited failure in a fresh transaction.
      if (isUniqueViolation(err)) {
        await db.transaction(async (tx) => {
          if (!(await markProcessed(tx, msg.messageId))) return;
          await enqueue(tx, {
            topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
            tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: {
              service: "asset", action: "tag_barcode", resourceType: "asset", resourceId: p.id, outcome: "failure",
              details: { failure: "DUPLICATE_BARCODE", barcode: p.barcode },
            },
          });
        });
        return;
      }
      throw err;
    }
    await cache.invalidate(cache.makeKey(msg.tenantId, "asset", p.id));
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
