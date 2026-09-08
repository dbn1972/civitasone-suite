import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import {
  computeThreeWayMatch, assertQtyValid, assertGrnAmendable,
  assertPoItemsResolved, assertGrnLinesResolved, assertDistinctReceiverInspector,
} from "./domain.js";
import { minorString } from "@civitasone/schemas/money";
import { allocateDocNo } from "../../shared/numbering.js";
import type { GrnItemInsert } from "./schema.js";
import { findPoById, findPoItemsByPoId } from "../po/repo.js";

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

    // DOM-002 — separation of duties: the receiving actor (msg.actorId, who
    // submitted this GRN) must not also be the inspector who determines
    // accept/reject on it. Checked before any I/O so a violation never
    // touches the DB.
    assertDistinctReceiverInspector(msg.actorId, p.inspection.inspectorId);

    // DOM-002 — re-derive orderedQty from the real PO line server-side.
    // Previously items[].orderedQty was trusted as-is from the client
    // payload, so a caller could understate the true ordered quantity (or
    // simply inflate it to match whatever they claimed to accept) and slip
    // past the over-accept guard below. A poItemRef that doesn't resolve
    // against the PO's real items is rejected rather than silently treated
    // as "unbounded" (see assertPoItemsResolved).
    const poId = p.poRef.replace(/^procurement_po:/, "");
    const po = await findPoById(poId, p.tenantId);
    const poItems = await findPoItemsByPoId(poId, p.tenantId);
    const poItemMap = new Map(poItems.map((pi) => [pi.id, pi]));
    assertPoItemsResolved(p.items.map((i) => i.poItemRef), new Set(poItemMap.keys()));

    const guardItems = p.items.map((i) => ({
      orderedQty: poItemMap.get(i.poItemRef)!.quantity,
      receivedQty: i.receivedQty,
      acceptedQty: i.acceptedQty,
    }));
    assertQtyValid(guardItems);

    const threeWayMatch = computeThreeWayMatch(guardItems, p.inspection.result);

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
      const itemRows: GrnItemInsert[] = p.items.map((i, idx) => ({
        id: randomUUID(), grnId: p.id, tenantId: p.tenantId,
        poItemRef: i.poItemRef, itemCode: i.itemCode,
        // DOM-002: server-derived orderedQty, not the client's i.orderedQty.
        orderedQty: guardItems[idx]!.orderedQty,
        receivedQty: i.receivedQty, acceptedQty: i.acceptedQty,
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
        await enqueue(tx, {
          topic: EVENTS.threeWayMatchPassed, eventType: EVENTS.threeWayMatchPassed,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { grnId: p.id, poRef: p.poRef, vendorId: p.vendorId },
        });
        // R7: transport money as exact strings, never Number(bigint paise).
        const grossMinorStr = po ? minorString(po.totalMinor) : "0";

        // Derive the authoritative PO and GRN(accepted) values server-side from
        // real PO line prices × GRN accepted qty — never from a caller. These
        // are persisted to the three-way-match table AND carried on the
        // grn.accepted event so finance can reconcile invoice↔GRN↔PO (R5).
        // po / poItemMap are already fetched above (DOM-002) — reused here
        // rather than re-fetched.
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
            id: randomUUID(),
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
          topic: EVENTS.threeWayMatchFailed, eventType: EVENTS.threeWayMatchFailed,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { grnId: p.id, poRef: p.poRef, vendorId: p.vendorId, reason: "qty_mismatch_or_inspection_failed" },
        });
        await enqueue(tx, {
          topic: EVENTS.grnRejected, eventType: EVENTS.grnRejected,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { grnId: p.id, poRef: p.poRef, vendorId: p.vendorId, reason: "qty_mismatch_or_inspection_failed" },
        });
      }
      await audit(tx, msg, "create", "grn", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "grn", p.id));
  });

  // Req 1.2 — GRN partial-delivery amendment. Only receivedQty/acceptedQty
  // per line change; grnNo, vendorId, poRef stay immutable. Re-asserts the
  // amendability guard under the transaction (the route-level check and this
  // write are not atomic, so a GRN accepted between the two must still block).
  queue.subscribe(COMMANDS.grnAmend, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string;
      lines: Array<{ lineId: string; receivedQty: number; acceptedQty: number }>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const grn = await repo.findGrnByIdTx(tx, p.id);
      if (!grn || grn.tenantId !== p.tenantId) throw new Error(`GRN ${p.id} not found`);
      assertGrnAmendable(grn);

      // DOM-002 — re-derive orderedQty from the GRN line actually persisted
      // at create time (itself now PO-derived — see the grnCreate handler
      // above), never from the client. Previously this call always passed
      // `orderedQty: 0`, which assertQtyValid treats as "no cap", disabling
      // the over-accept guard on every amendment regardless of the real PO
      // quantity.
      const existingItems = await repo.findGrnItemsByGrnTx(tx, p.id);
      const existingByLine = new Map(existingItems.map((i) => [i.id, i]));
      assertGrnLinesResolved(p.lines.map((l) => l.lineId), new Set(existingByLine.keys()));
      assertQtyValid(p.lines.map((l) => ({
        orderedQty: existingByLine.get(l.lineId)!.orderedQty,
        receivedQty: l.receivedQty, acceptedQty: l.acceptedQty,
      })));

      for (const line of p.lines) {
        await repo.updateGrnItemQty(tx, line.lineId, p.id, {
          receivedQty: line.receivedQty,
          acceptedQty: line.acceptedQty,
          updatedBy: msg.actorId,
        });
      }
      await enqueue(tx, {
        topic: EVENTS.grnAmended, eventType: EVENTS.grnAmended,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { grnId: p.id, lines: p.lines },
      });
      await audit(tx, msg, "amend", "grn", p.id);
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
