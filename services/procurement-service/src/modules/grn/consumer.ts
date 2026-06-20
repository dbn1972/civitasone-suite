import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { computeThreeWayMatch, assertQtyValid } from "./domain.js";
import type { GrnItemInsert } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

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
      await repo.insertGrn(tx, {
        id: p.id, tenantId: p.tenantId, grnNo: p.grnNo, poRef: p.poRef,
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
        await enqueue(tx, {
          topic: EVENTS.grnAccepted, eventType: EVENTS.grnAccepted,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { grnId: p.id, poRef: p.poRef, vendorId: p.vendorId },
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

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "procurement", action, resourceType, resourceId, outcome: "success" },
  });
}
