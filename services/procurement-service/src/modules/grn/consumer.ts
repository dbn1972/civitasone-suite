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
  assertGrnInspectable,
} from "./domain.js";
import { minorString } from "@civitasone/schemas/money";
import { allocateDocNo } from "../../shared/numbering.js";
import type { GrnItemInsert } from "./schema.js";
import { findPoById, findPoItemsByPoId, findPoByIdTx, findPoItemsByPoIdTx } from "../po/repo.js";

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
    };

    // DOM-002 — re-derive orderedQty from the real PO line server-side.
    // Previously items[].orderedQty was trusted as-is from the client
    // payload, so a caller could understate the true ordered quantity (or
    // simply inflate it to match whatever they claimed to accept) and slip
    // past the over-accept guard below. A poItemRef that doesn't resolve
    // against the PO's real items is rejected rather than silently treated
    // as "unbounded" (see assertPoItemsResolved).
    const poId = p.poRef.replace(/^procurement_po:/, "");
    const poItems = await findPoItemsByPoId(poId, p.tenantId);
    const poItemMap = new Map(poItems.map((pi) => [pi.id, pi]));
    assertPoItemsResolved(p.items.map((i) => i.poItemRef), new Set(poItemMap.keys()));

    const guardItems = p.items.map((i) => ({
      orderedQty: poItemMap.get(i.poItemRef)!.quantity,
      receivedQty: i.receivedQty,
      acceptedQty: i.acceptedQty,
    }));
    // Only the qty/bounds guard runs at receive time — there is no
    // inspection verdict yet, so computeThreeWayMatch (which also weighs
    // pass/fail) is deferred entirely to the accept/reject step below.
    assertQtyValid(guardItems);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const grnNo = await allocateDocNo(tx, p.tenantId, "grn");
      // DOM-002 — grnCreate is now a receive-only step: it persists the GRN
      // in `under_inspection`, awaiting a SEPARATE, independently
      // authenticated actor to accept or reject it via COMMANDS.grnAccept /
      // COMMANDS.grnReject below. No inspection row is written here and no
      // accepted/rejected decision is made in this call — that used to
      // happen inline, driven by a client-supplied
      // `inspection.inspectorId` that was never actually a verified,
      // distinct person (see grn/domain.ts assertDistinctReceiverInspector).
      await repo.insertGrn(tx, {
        id: p.id, tenantId: p.tenantId, grnNo, poRef: p.poRef,
        vendorId: p.vendorId,
        receivedDate: p.receivedDate ?? new Date().toISOString().slice(0, 10),
        threeWayMatch: false, status: "under_inspection",
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
      await audit(tx, msg, "create", "grn", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "grn", p.id));
  });

  // DOM-002 — wires the previously-unwired COMMANDS.grnAccept. The route at
  // PATCH /v1/procurement/grns/:id/accept already existed (grn/routes.ts)
  // and already published this command, but no consumer ever subscribed to
  // it — every accept request was silently dead-lettered and the GRN never
  // actually moved out of whatever status grnCreate had already forced it
  // into. This is now the real inspection "pass" step: msg.actorId here is
  // the CALLER of PATCH /accept's own authenticated identity (set from
  // ctx.actorId in commands.ts, never from a client-supplied field), so it
  // is genuinely a second, independently-authenticated actor from whoever
  // ran the earlier CREATE call.
  queue.subscribe(COMMANDS.grnAccept, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; remarks?: string };
    await inspectGrn(msg, p.id, p.tenantId, "pass", p.remarks ?? null);
  });

  // DOM-002 — wires the previously-unwired COMMANDS.grnReject the same way:
  // the real inspection "fail" step, inspector identity from msg.actorId
  // (the caller of PATCH /reject), never client-supplied.
  queue.subscribe(COMMANDS.grnReject, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string };
    await inspectGrn(msg, p.id, p.tenantId, "fail", p.reason ?? null);
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

/**
 * DOM-002 — the real, second-actor inspection step shared by
 * COMMANDS.grnAccept ("pass") and COMMANDS.grnReject ("fail"). Runs entirely
 * under one DB transaction lock so the status check, the SoD check, and the
 * write are atomic with respect to a concurrent accept/reject on the same
 * GRN. Everything from here down — three-way-match computation, PO/GRN
 * amount derivation, and the accepted/rejected outbox events — is unchanged
 * from what used to run inline inside grnCreate; it has simply moved to
 * where the inspection verdict actually exists.
 */
async function inspectGrn(
  msg: { tenantId: string; actorId: string; correlationId: string; messageId: string },
  grnId: string,
  tenantId: string,
  result: "pass" | "fail",
  remarks: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const grn = await repo.findGrnByIdTx(tx, grnId);
    if (!grn || grn.tenantId !== tenantId) throw new Error(`GRN ${grnId} not found`);
    assertGrnInspectable(grn);
    // DOM-002 — separation of duties, re-checked under the DB lock
    // (defense-in-depth): the route-level check in commands.ts and this
    // write are not atomic. `grn.createdBy` is the CREATE call's own
    // actorId, persisted at receive time; `msg.actorId` is THIS
    // accept/reject call's own actorId. Both are independently
    // authenticated — neither comes from a client-supplied field.
    assertDistinctReceiverInspector(grn.createdBy, msg.actorId);

    const items = await repo.findGrnItemsByGrnTx(tx, grnId);
    const guardItems = items.map((i) => ({
      orderedQty: i.orderedQty, receivedQty: i.receivedQty, acceptedQty: i.acceptedQty,
    }));
    const threeWayMatch = computeThreeWayMatch(guardItems, result);

    await repo.updateGrn(tx, grnId, {
      status: threeWayMatch ? "accepted" : "rejected",
      threeWayMatch,
      updatedBy: msg.actorId,
    });
    await repo.insertInspection(tx, {
      id: randomUUID(), grnId, tenantId,
      inspectorId: msg.actorId,
      inspectionDate: new Date().toISOString().slice(0, 10),
      result, remarks: remarks ?? null,
      createdBy: msg.actorId, updatedBy: msg.actorId,
    });

    // TX-001 (procurement) — discovered auditing three-way-match/consumer.ts's
    // fix for the same bug class: these two reads sat inside inspectGrn's
    // already-open db.transaction() (line above) but were bare, non-tx
    // calls that each opened their own nested db.transaction(), same
    // pool-deadlock-under-load shape as three-way-match's four sites. Not
    // in the gap report's evidence column for this file — found by direct
    // review, not the heuristic scanner (which also missed it; see PR body).
    const poId = grn.poRef.replace(/^procurement_po:/, "");
    const po = await findPoByIdTx(tx, poId, tenantId);
    const poItems = await findPoItemsByPoIdTx(tx, poId, tenantId);
    const poItemMap = new Map(poItems.map((pi) => [pi.id, pi]));

    if (threeWayMatch) {
      await enqueue(tx, {
        topic: EVENTS.threeWayMatchPassed, eventType: EVENTS.threeWayMatchPassed,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { grnId, poRef: grn.poRef, vendorId: grn.vendorId },
      });
      // R7: transport money as exact strings, never Number(bigint paise).
      const grossMinorStr = po ? minorString(po.totalMinor) : "0";

      // Derive the authoritative PO and GRN(accepted) values server-side from
      // real PO line prices × GRN accepted qty — never from a caller. These
      // are persisted to the three-way-match table AND carried on the
      // grn.accepted event so finance can reconcile invoice↔GRN↔PO (R5).
      const poAmountMinor = po ? BigInt(po.totalMinor) : 0n;
      let grnAmountMinor = 0n;
      for (const gi of items) {
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
          tenantId, poId, grnId,
          poAmountMinor, grnAmountMinor, matchStatus,
        });
      }
      const enrichedItems = items.map((gi) => {
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
          grnId, poRef: grn.poRef, vendorId: grn.vendorId, grossMinor: grossMinorStr,
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
        payload: { grnId, poRef: grn.poRef, vendorId: grn.vendorId, reason: "qty_mismatch_or_inspection_failed" },
      });
      await enqueue(tx, {
        topic: EVENTS.grnRejected, eventType: EVENTS.grnRejected,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { grnId, poRef: grn.poRef, vendorId: grn.vendorId, reason: "qty_mismatch_or_inspection_failed" },
      });
    }
    await audit(tx, msg, result === "pass" ? "accept" : "reject", "grn", grnId);
  });
  await cache.invalidate(cache.makeKey(msg.tenantId, "grn", grnId));
}

async function audit(tx: Parameters<typeof enqueue>[0], msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "procurement", action, resourceType, resourceId, outcome: "success" },
  });
}
