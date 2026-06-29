import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { computeThreeWayMatch, assertQtyValid } from "./domain.js";
import { minorString } from "@civitasone/schemas/money";
import { allocateDocNo } from "../../shared/numbering.js";
import type { GrnItemInsert } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

function inferItemType(itemCode: string, poItemType?: string | null): string {
  if (poItemType) return poItemType;
  if (/^(FA|AST|FIX)/i.test(itemCode)) return "fixed_asset";
  return "consumable";
}

export function registerGrnConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.grnCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; grnNo: string; poRef: string; vendorId: string;
      receivedDate?: string; notes?: string;
      items: Array<{ poItemRef: string; itemCode: string; orderedQty: number; receivedQty: number; acceptedQty: number; unit: string }>;
      inspection: { inspectorId: string; result: string; remarks?: string };
    };

    assertQtyValid(p.items.map((i) => ({
      orderedQty: i.orderedQty, receivedQty: i.receivedQty, acceptedQty: i.acceptedQty,
    })));

    const threeWayMatch = computeThreeWayMatch(
      p.items.map((i) => ({ orderedQty: i.orderedQty, receivedQty: i.receivedQty, acceptedQty: i.acceptedQty })),
      p.inspection.result
    );

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const grnNo = await allocateDocNo(tx, p.tenantId, "grn");
      await repo.insertGrn(tx, {
        id: p.id, tenantId: p.tenantId, grnNo, poRef: p.poRef,
        vendorId: p.vendorId,
        receivedDate: p.receivedDate ?? new Date().toISOString().slice(0, 10),
        threeWayMatch, status: threeWayMatch ? "accepted" : "rejected",
        notes: p.notes ?? null, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      const itemRows: GrnItemInsert[] = p.items.map((i) => ({
        id: randomUUID(), grnId: p.id, tenantId: p.tenantId,
        poItemRef: i.poItemRef, itemCode: i.itemCode,
        orderedQty: i.orderedQty, receivedQty: i.receivedQty, acceptedQty: i.acceptedQty,
        unit: i.unit, createdBy: msg.actorId, updatedBy: msg.actorId,
      }));
      await repo.insertGrnItems(tx, itemRows);
      await repo.insertInspection(tx, {
        id: randomUUID(), grnId: p.id, tenantId: p.tenantId,
        inspectorId: p.inspection.inspectorId,
        inspectionDate: new Date().toISOString().slice(0, 10),
        result: p.inspection.result, remarks: p.inspection.remarks ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      if (threeWayMatch) {
        const poId = p.poRef.replace(/^procurement_po:/, "");
        const po = await import("../po/repo.js").then((m) => m.findPoById(poId, p.tenantId));
        const poItems = await import("../po/repo.js").then((m) => m.findPoItemsByPoId(poId, p.tenantId));
        const poItemMap = new Map(poItems.map((pi) => [pi.id, pi]));
        // R7: transport money as exact strings, never Number(bigint paise).
        const grossMinorStr = po ? minorString(po.totalMinor) : "0";

        // Derive the authoritative PO and GRN(accepted) values server-side from
        // real PO line prices × GRN accepted qty — never from a caller. These
        // are persisted to the three-way-match table AND carried on the
        // grn.accepted event so finance can reconcile invoice↔GRN↔PO (R5).
        const poAmountMinor = po ? BigInt(po.totalMinor) : 0n;
        let grnAmountMinor = 0n;
        for (const gi of p.items) {
          const poItem = poItemMap.get(gi.poItemRef);
          if (poItem) grnAmountMinor += BigInt(poItem.unitPriceMinor) * BigInt(gi.acceptedQty);
        }

        // Persist a server-DERIVED three-way match (PO vs GRN). The payment gate
        // reads this table.
        if (po) {
          const variancePct = poAmountMinor > 0n
            ? Number((poAmountMinor > grnAmountMinor ? poAmountMinor - grnAmountMinor : grnAmountMinor - poAmountMinor) * 10000n / poAmountMinor) / 100
            : 0;
          const matchStatus = variancePct <= 2 ? "matched" : variancePct <= 5 ? "matched" : "mismatch";
          const { upsertDerivedMatch } = await import("../three-way-match/repo.js");
          await upsertDerivedMatch(tx, {
            tenantId: p.tenantId, poId, grnId: p.id,
            poAmountMinor, grnAmountMinor, matchStatus,
          });
        }
        const enrichedItems = p.items.map((gi) => {
          const poItem = poItemMap.get(gi.poItemRef);
          const itemType = inferItemType(gi.itemCode, poItem?.itemType);
          return {
            itemCode: gi.itemCode,
            itemName: poItem?.description ?? gi.itemCode,
            acceptedQty: gi.acceptedQty,
            rateMinor: poItem ? minorString(poItem.unitPriceMinor) : "0",
            currency: poItem?.currency ?? "INR",
            itemType,
            itemId: poItem?.id,
          };
        });
        await enqueue(tx, {
          topic: EVENTS.grnAccepted, eventType: EVENTS.grnAccepted,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            grnId: p.id, poRef: p.poRef, vendorId: p.vendorId, grossMinor: grossMinorStr,
            // R5: paise as strings so > 2^53 stays exact across the queue boundary.
            poAmountMinor: poAmountMinor.toString(),
            grnAmountMinor: grnAmountMinor.toString(),
            items: enrichedItems,
          },
        });
      } else {
        await enqueue(tx, {
          topic: EVENTS.grnRejected, eventType: EVENTS.grnRejected,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { grnId: p.id, poRef: p.poRef, reason: "qty_mismatch_or_inspection_failed" },
        });
      }
      await audit(tx, msg, "create", "grn", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "grn", p.id));
  });
}

async function audit(tx: Parameters<typeof enqueue>[0], msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "procurement", action, resourceType, resourceId, outcome: "success" },
  });
}
