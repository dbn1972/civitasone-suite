import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { measurementBooks, measurements, bills, accountCompilations } from "./schema.js";
import { calculateNetPayable, billedQuantityExceedsBoq } from "./domain.js";
import { boqItems } from "../boq/schema.js";
import { eq, and } from "drizzle-orm";

export function registerBillingConsumers(q: Queue): void {
  q.subscribe(COMMANDS.mbIssue, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      await tx.insert(measurementBooks).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        workId: p.workId as string,
        awardId: p.awardId as string,
        mbNumber: p.mbNumber as string,
        issuedBy: msg.actorId,
        status: "draft",
      });

      await enqueue(tx, {
        topic: EVENTS.mbIssued,
        eventType: EVENTS.mbIssued,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, workId: p.workId },
      });
    });
  });

  q.subscribe(COMMANDS.mbFinalize, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const { id, nextStatus } = msg.payload as { id: string; nextStatus: string };
      await tx.update(measurementBooks)
        .set({ status: nextStatus })
        .where(eq(measurementBooks.id, id));

      await enqueue(tx, {
        topic: EVENTS.mbFinalized,
        eventType: EVENTS.mbFinalized,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id, status: nextStatus },
      });
    });
  });

  q.subscribe(COMMANDS.billCreate, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      const gross = BigInt(p.grossAmountMinor as string | number);
      const deductions = BigInt((p.deductionsMinor as string | number) ?? 0);
      const netPayable = calculateNetPayable(gross, deductions);

      await tx.insert(bills).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        workId: p.workId as string,
        awardId: p.awardId as string,
        mbId: (p.mbId as string) ?? undefined,
        billMode: p.billMode as string,
        billNumber: p.billNumber as string,
        grossAmountMinor: gross,
        deductionsMinor: deductions,
        netPayableMinor: netPayable,
        status: "draft",
        createdBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.billCreated,
        eventType: EVENTS.billCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, workId: p.workId, netPayableMinor: netPayable.toString() },
      });
    });
  });

  q.subscribe(COMMANDS.billFinalize, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const { id, nextStatus } = msg.payload as { id: string; nextStatus: string };
      await tx.update(bills)
        .set({ status: nextStatus })
        .where(eq(bills.id, id));

      await enqueue(tx, {
        topic: EVENTS.billFinalized,
        eventType: EVENTS.billFinalized,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id, status: nextStatus },
      });
    });
  });

  // ORPHAN FIX: record a measurement line against an MB. Enforces
  // FR-BIL-011 — billed quantity may not exceed the approved BoQ quantity.
  q.subscribe(COMMANDS.measurementRecord, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      const boqItemId = p.boqItemId as string;
      const quantity = Number(p.quantity as number);

      const boqRows = await tx.select().from(boqItems)
        .where(and(eq(boqItems.tenantId, msg.tenantId), eq(boqItems.id, boqItemId)))
        .limit(1);
      const boq = boqRows[0];
      if (boq && billedQuantityExceedsBoq(quantity, Number(boq.quantity))) {
        return; // reject: measured quantity exceeds the approved BoQ quantity
      }

      await tx.insert(measurements).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        mbId: p.mbId as string,
        boqItemId,
        quantity: String(quantity),
        numberVal: p.numberVal !== undefined ? String(p.numberVal) : null,
        lengthVal: p.lengthVal !== undefined ? String(p.lengthVal) : null,
        breadthVal: p.breadthVal !== undefined ? String(p.breadthVal) : null,
        depthVal: p.depthVal !== undefined ? String(p.depthVal) : null,
        remarks: (p.remarks as string) ?? null,
      });

      await enqueue(tx, {
        topic: EVENTS.measurementRecorded,
        eventType: EVENTS.measurementRecorded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, mbId: p.mbId, boqItemId },
      });
    });
  });

  // ORPHAN FIX: compile a monthly account for submission to DAG.
  q.subscribe(COMMANDS.accountCompile, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      await tx.insert(accountCompilations).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        month: p.month as number,
        year: p.year as number,
        status: "compiled",
        submittedTo: (p.submittedTo as string) ?? null,
      });

      await enqueue(tx, {
        topic: EVENTS.accountCompiled,
        eventType: EVENTS.accountCompiled,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, month: p.month, year: p.year },
      });
    });
  });
}
