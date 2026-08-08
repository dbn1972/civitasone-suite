import type { Queue } from "@civitasone/queue";
import { parseMinor } from "@civitasone/schemas";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { measurementBooks, measurements, bills, accountCompilations } from "./schema.js";
import { calculateNetPayable, billedQuantityExceedsBoq, canCreateBill } from "./domain.js";
import { boqItems } from "../boq/schema.js";
import { eq, and } from "drizzle-orm";

const AUDIT_TOPIC = "audit.event.record";

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
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "process", resourceType: "billing", resourceId: p.id, outcome: "success" } });
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
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "finalize", resourceType: "mb", resourceId: id, outcome: "success" } });
    });
  });

  q.subscribe(COMMANDS.billCreate, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;

      // canCreateBill gate (defense-in-depth — also enforced pre-enqueue in
      // billing/routes.ts): if this bill references an MB, that MB must be
      // fully finalized (do_finalized) before a bill can be persisted against it.
      const mbId = p.mbId as string | undefined;
      if (mbId) {
        const mbRows = await tx.select().from(measurementBooks)
          .where(and(eq(measurementBooks.tenantId, msg.tenantId), eq(measurementBooks.id, mbId)))
          .limit(1);
        const mb = mbRows[0];
        if (!mb || !canCreateBill(mb.status)) {
          return; // reject: MB missing or not in an allowed status for bill creation
        }
      }

      const gross = parseMinor(p.grossAmountMinor as string | number | bigint);
      const deductions = parseMinor((p.deductionsMinor as string | number | bigint) ?? 0);
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
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "create", resourceType: "bill", resourceId: p.id, outcome: "success" } });
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
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "finalize", resourceType: "bill", resourceId: id, outcome: "success" } });
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
      if (!boq) {
        return; // reject: a measurement against a non-existent BoQ item is invalid
      }

      // FR-BIL-011: enforce the CUMULATIVE billing ceiling. Sum every prior
      // measurement recorded against this BoQ item, add the current quantity,
      // and reject if the running total exceeds the approved BoQ quantity.
      const priorMeasurements = await tx.select().from(measurements)
        .where(and(eq(measurements.tenantId, msg.tenantId), eq(measurements.boqItemId, boqItemId)));
      const priorBilled = priorMeasurements.reduce((sum, r) => sum + Number(r.quantity ?? 0), 0);
      const cumulative = priorBilled + quantity;
      if (billedQuantityExceedsBoq(cumulative, Number(boq.quantity))) {
        return; // reject: cumulative measured quantity exceeds the approved BoQ quantity
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
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "process", resourceType: "billing", resourceId: p.id, outcome: "success" } });
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
      await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "works-service", action: "process", resourceType: "billing", resourceId: p.id, outcome: "success" } });
    });
  });
}
