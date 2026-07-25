import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { boqItems, recapitulation } from "./schema.js";
import { measurements } from "../billing/schema.js";
import { awards } from "../tender/schema.js";
import { calculateBoqAmount, calculateRecapitulation } from "./domain.js";
import { eq, and } from "drizzle-orm";

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

  // ORPHAN FIX: update a BoQ item — recompute amount when rate/quantity change.
  q.subscribe(COMMANDS.boqUpdateItem, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      const id = p.id as string;

      const rows = await tx.select().from(boqItems)
        .where(and(eq(boqItems.tenantId, msg.tenantId), eq(boqItems.id, id)))
        .limit(1);
      const current = rows[0];
      if (!current) return; // nothing to update — reject silently

      // Do not allow the quantity of an already-billed BoQ item to change — a
      // measurement references it as the billing ceiling.
      if (p.quantity !== undefined && Number(p.quantity) !== Number(current.quantity)) {
        const measRefs = await tx.select().from(measurements)
          .where(and(eq(measurements.tenantId, msg.tenantId), eq(measurements.boqItemId, id)));
        if (measRefs.length > 0) return; // referenced by a measurement — block quantity change
      }

      const rate = p.rate !== undefined ? BigInt(p.rate as string | number) : current.rate;
      const quantity = p.quantity !== undefined ? (p.quantity as number) : Number(current.quantity);
      const amountMinor = calculateBoqAmount(rate, quantity);

      const patch: Record<string, unknown> = { rate, quantity: String(quantity), amountMinor };
      if (p.itemDescription !== undefined) patch.itemDescription = p.itemDescription as string;
      if (p.unit !== undefined) patch.unit = p.unit as string;
      if (p.remarks !== undefined) patch.remarks = p.remarks as string;

      await tx.update(boqItems)
        .set(patch)
        .where(and(eq(boqItems.tenantId, msg.tenantId), eq(boqItems.id, id)));

      await enqueue(tx, {
        topic: EVENTS.boqItemUpdated,
        eventType: EVENTS.boqItemUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id, workId: current.workId, amountMinor: amountMinor.toString() },
      });
    });
  });

  // ORPHAN FIX: delete a BoQ item.
  q.subscribe(COMMANDS.boqDeleteItem, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      const id = p.id as string;

      // Do not disable the billing ceiling: block the delete when the item is
      // referenced by any measurement, or when the work already has an active
      // award. (There is no lock field on boqItems — enforce via reference check.)
      const measRefs = await tx.select().from(measurements)
        .where(and(eq(measurements.tenantId, msg.tenantId), eq(measurements.boqItemId, id)));
      if (measRefs.length > 0) return; // referenced by a measurement — block delete

      const boqRows = await tx.select().from(boqItems)
        .where(and(eq(boqItems.tenantId, msg.tenantId), eq(boqItems.id, id)))
        .limit(1);
      const current = boqRows[0];
      if (current) {
        const awardRefs = await tx.select().from(awards)
          .where(and(eq(awards.tenantId, msg.tenantId), eq(awards.workId, current.workId)));
        const hasActiveAward = awardRefs.some(
          (a) => a.status === "dao_finalized" || a.status === "do_finalized",
        );
        if (hasActiveAward) return; // active award exists — block delete
      }

      await tx.delete(boqItems)
        .where(and(eq(boqItems.tenantId, msg.tenantId), eq(boqItems.id, id)));

      await enqueue(tx, {
        topic: EVENTS.boqItemDeleted,
        eventType: EVENTS.boqItemDeleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id },
      });
    });
  });
}
