import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { boqItems, recapitulation } from "./schema.js";
import { calculateBoqAmount, calculateRecapitulation } from "./domain.js";

export function registerBoqConsumers(q: Queue): void {
  q.subscribe(COMMANDS.boqAddItem, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      const rate = BigInt(p.rate as string | number);
      const quantity = p.quantity as number;
      const amountMinor = calculateBoqAmount(rate, quantity);

      await tx.insert(boqItems).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        workId: p.workId as string,
        srItemId: (p.srItemId as string) ?? null,
        itemDescription: p.itemDescription as string,
        itemCode: (p.itemCode as string) ?? null,
        unit: p.unit as string,
        rate,
        quantity: String(quantity),
        numberVal: p.numberVal ? String(p.numberVal) : null,
        lengthVal: p.lengthVal ? String(p.lengthVal) : null,
        breadthVal: p.breadthVal ? String(p.breadthVal) : null,
        depthVal: p.depthVal ? String(p.depthVal) : null,
        scopeId: (p.scopeId as string) ?? null,
        remarks: (p.remarks as string) ?? null,
        amountMinor,
        createdBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.boqItemAdded,
        eventType: EVENTS.boqItemAdded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, workId: p.workId, amountMinor: amountMinor.toString() },
      });
    });
  });

  q.subscribe(COMMANDS.boqRecapitulate, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      const workAmount = BigInt(p.workAmount as string | number);
      const charges = {
        contingencyPercent: p.contingencyPercent as number,
        turnoverTaxPercent: p.turnoverTaxPercent as number,
        workChargePercent: p.workChargePercent as number,
        qualityControlPercent: p.qualityControlPercent as number,
        centagePercent: p.centagePercent as number,
        otherCharges: BigInt((p.otherCharges as string | number) ?? 0),
      };
      const grandTotal = calculateRecapitulation(workAmount, charges);

      await tx.insert(recapitulation).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        workId: p.workId as string,
        workAmount,
        contingencyPercent: String(charges.contingencyPercent),
        turnoverTaxPercent: String(charges.turnoverTaxPercent),
        workChargePercent: String(charges.workChargePercent),
        qualityControlPercent: String(charges.qualityControlPercent),
        centagePercent: String(charges.centagePercent),
        otherCharges: charges.otherCharges,
        grandTotal,
      });

      await enqueue(tx, {
        topic: EVENTS.boqRecapitulated,
        eventType: EVENTS.boqRecapitulated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { workId: p.workId, grandTotal: grandTotal.toString() },
      });
    });
  });
}
