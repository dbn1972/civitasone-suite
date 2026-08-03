import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, CONSUMED, EVENTS } from "../../topics.js";
import { uuidV5 } from "../../shared/ids.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";
const GL_TOPIC    = "finance.gl.post";
// 4-digit finance head CODES (resolved by finance via findHeadByCodeTx). These
// must exist in budget.finance_heads. Overridable via env to match a tenant's
// chart of accounts.
const FIXED_ASSET_CODE  = process.env.ASSET_FIXED_ASSET_CODE ?? "1200";
const GRN_CLEARING_CODE = process.env.ASSET_GRN_CLEARING_CODE ?? "2070";
// Offset for a DIRECT asset registration (no GRN/procurement context). Dr
// Fixed Asset (1200) / Cr this head. Defaults to AP Control (2050); override
// per a tenant chart of accounts (e.g. Capital Account 3001 for donations).
const ACQ_OFFSET_CODE   = process.env.ASSET_ACQUISITION_OFFSET_CODE ?? "2050";
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
      // GAP-FIX: a DIRECT asset registration must hit the books exactly like a
      // GRN auto-capitalization does -- previously only the GRN path posted an
      // acquisition journal, so a manually-registered asset existed in the asset
      // register but never in the GL (carrying amount silently off the balance
      // sheet). Emit a balanced StandardJournal Dr Fixed Asset (1200) / Cr AP
      // (2050), with a deterministic uuidV5 id keyed off the assetId so a
      // redelivered create no-ops in finance (single balanced post, no double).
      // Skip a zero-cost create so finance never sees a zero-total journal.
      if (costMinor > 0n) {
        await enqueue(tx, {
          topic: GL_TOPIC, eventType: GL_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            id: uuidV5(`acq:${p.id}`),
            tenantId: msg.tenantId,
            type: "asset_acquisition",
            voucherNo: `ACQ/${p.acquisitionDate}/${p.id.slice(0, 8)}`,
            postingDate: p.acquisitionDate,
            lines: [
              { accountCode: FIXED_ASSET_CODE, debitMinor: costMinor.toString(), creditMinor: "0" },
              { accountCode: ACQ_OFFSET_CODE, debitMinor: "0", creditMinor: costMinor.toString() },
            ],
          },
        });
      }
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
        // P0-1/P0-2: acquisition GL on capitalization. Finance's GL consumer
        // treats anything that is NOT type:"depreciation"/"asset_disposal" as a
        // StandardJournal and requires {id, tenantId, voucherNo, type,
        // postingDate, lines:[{accountCode,debitMinor,creditMinor}]} with
        // balanced string-paise legs resolved by 4-digit head CODE. The old
        // payload had none of that shape (no lines/postingDate/tenantId) and a
        // truncated id `acq:` (no assetId) — finance silently dropped it and any
        // redelivery shared the same blank key. We now emit a balanced
        // StandardJournal: Dr Fixed Asset (1200) / Cr GRN-Clearing (2070), with
        // a deterministic id `acq:${assetId}` so a redelivered GRN hits the
        // journal PK in finance and no-ops (single balanced post, no double).
        const acqDate = new Date().toISOString().slice(0, 10);
        await enqueue(tx, {
          topic: GL_TOPIC, eventType: GL_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            // finance.finance_journals.id is a uuid column. The human-readable
            // key `acq:${assetId}` is hashed into a stable RFC-4122 UUIDv5 so the
            // journal id is both deterministic (redelivery hits the PK -> no-op)
            // and a valid uuid (no dead-letter on the uuid cast).
            id: uuidV5(`acq:${assetId}`),
            tenantId: msg.tenantId,
            type: "asset_acquisition",
            voucherNo: `ACQ/${acqDate}/${assetId.slice(0, 8)}`,
            postingDate: acqDate,
            lines: [
              { accountCode: FIXED_ASSET_CODE, debitMinor: totalCost.toString(), creditMinor: "0" },
              { accountCode: GRN_CLEARING_CODE, debitMinor: "0", creditMinor: totalCost.toString() },
            ],
          },
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

  queue.subscribe(COMMANDS.assetTagBarcode, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; barcode: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateAssetBarcode(tx, p.id, p.tenantId, p.barcode, msg.actorId);
      await audit(tx, msg, "tag_barcode", "asset", p.id);
    });
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
