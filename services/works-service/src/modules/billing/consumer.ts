import { NonRetryableError, type Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { parseMinor } from "@civitasone/schemas";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, FINANCE_HANDOFF } from "../../topics.js";
import { measurementBooks, measurements, bills, accountCompilations } from "./schema.js";
import { calculateNetPayable, billedQuantityExceedsBoq, canCreateBill, billAmountExceedsAward, isTerminalBillStatus } from "./domain.js";
import { boqItems } from "../boq/schema.js";
import { awards } from "../tender/schema.js";
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
          throw new NonRetryableError("MB_INVALID_STATUS: measurement book missing or not in allowed status for bill creation");
        }
      }

      const gross = parseMinor(p.grossAmountMinor as string | number | bigint);
      const deductions = parseMinor((p.deductionsMinor as string | number | bigint) ?? 0);
      const netPayable = calculateNetPayable(gross, deductions);

      const workId = p.workId as string;
      const awardId = p.awardId as string;

      // FR-BIL-012: cumulative gross billed amount must not exceed award ceiling.
      const awardRows = await tx.select().from(awards)
        .where(and(eq(awards.tenantId, msg.tenantId), eq(awards.id, awardId)))
        .limit(1);
      const award = awardRows[0];
      if (!award) throw new NonRetryableError("AWARD_NOT_FOUND: award record not found for bill create");

      const priorBillRows = await tx.select().from(bills)
        .where(and(eq(bills.tenantId, msg.tenantId), eq(bills.workId, workId)));
      const priorBilledGross = priorBillRows.reduce(
        (sum, row) => sum + (row.grossAmountMinor ?? 0n),
        0n,
      );
      if (billAmountExceedsAward(priorBilledGross, gross, award.acceptedAmountMinor)) {
        throw new NonRetryableError("AWARD_CEILING_EXCEEDED: cumulative billed amount exceeds award ceiling");
      }

      await tx.insert(bills).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        workId,
        awardId,
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

  // billFinalize involves DB write, tax calculation, PDF/invoice generation;
  // 300s timeout prevents redelivery while the first handler is still running.
  q.subscribe(COMMANDS.billFinalize, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const { id, nextStatus } = msg.payload as { id: string; nextStatus: string };

      const billRows = await tx.select().from(bills)
        .where(and(eq(bills.tenantId, msg.tenantId), eq(bills.id, id)))
        .limit(1);
      const bill = billRows[0];
      if (!bill) throw new NonRetryableError("BILL_NOT_FOUND: bill record not found for finalization");

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

      // Finance hand-off: DO-finalized RA bill → draft vendor bill in finance-service.
      if (isTerminalBillStatus(nextStatus)) {
        const awardRows = await tx.select().from(awards)
          .where(and(eq(awards.tenantId, msg.tenantId), eq(awards.id, bill.awardId)))
          .limit(1);
        const award = awardRows[0];
        const financeBillId = randomUUID();
        const headId = process.env.WORKS_FINANCE_DEFAULT_HEAD_ID
          ?? process.env.FINANCE_DEFAULT_HEAD_ID
          ?? "dddddddd-0001-0000-0000-000000000001";

        await enqueue(tx, {
          topic: FINANCE_HANDOFF.billCreate,
          eventType: FINANCE_HANDOFF.billCreate,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            id: financeBillId,
            tenantId: msg.tenantId,
            billNo: bill.billNumber,
            vendorId: `works_award:${bill.awardId}`,
            headId,
            grossMinor: bill.grossAmountMinor.toString(),
            netMinor: bill.netPayableMinor.toString(),
            currency: "INR",
            deductions: [],
            poRef: `works_award:${bill.awardId}`,
            grnRef: `works_bill:${bill.id}`,
            billDate: new Date().toISOString().slice(0, 10),
            contractorName: award?.contractorName ?? null,
            workId: bill.workId,
            worksBillId: bill.id,
          },
        });
      }
    });
  }, { visibilityTimeout: 300 });

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
        throw new NonRetryableError("INVALID_BOQ_REF: measurement references non-existent BoQ item");
      }

      // FR-BIL-011: enforce the CUMULATIVE billing ceiling. Sum every prior
      // measurement recorded against this BoQ item, add the current quantity,
      // and reject if the running total exceeds the approved BoQ quantity.
      const priorMeasurements = await tx.select().from(measurements)
        .where(and(eq(measurements.tenantId, msg.tenantId), eq(measurements.boqItemId, boqItemId)));
      const priorBilled = priorMeasurements.reduce((sum, r) => sum + Number(r.quantity ?? 0), 0);
      const cumulative = priorBilled + quantity;
      if (billedQuantityExceedsBoq(cumulative, Number(boq.quantity))) {
        throw new NonRetryableError("BOQ_QUANTITY_EXCEEDED: cumulative measurement exceeds approved BoQ quantity");
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
