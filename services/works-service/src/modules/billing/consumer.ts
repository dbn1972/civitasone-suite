import { NonRetryableError, type Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { parseMinor } from "@civitasone/schemas";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, FINANCE_HANDOFF } from "../../topics.js";
import { measurementBooks, measurements, bills, billItems, accountCompilations } from "./schema.js";
import {
  calculateNetPayable, billedQuantityExceedsBoq, canCreateBill, billAmountExceedsAward,
  isTerminalBillStatus, awardBelongsToWork, mbBelongsToBill, billAmountExceedsMeasuredValue,
  computeMeasuredValueMinor, boqItemBelongsToMbWork,
} from "./domain.js";
import { boqItems } from "../boq/schema.js";
import { calculateBoqAmount } from "../boq/domain.js";
import { awards } from "../tender/schema.js";
import { eq, and, inArray } from "drizzle-orm";

const AUDIT_TOPIC = "audit.event.record";

export function registerBillingConsumers(q: Queue): void {
  q.subscribe(COMMANDS.mbIssue, async (msg) => {
    await db.transaction(async (tx) => {
      const ok = await markProcessed(tx, msg.messageId);
      if (!ok) return;

      const p = msg.payload as Record<string, unknown>;
      const workId = p.workId as string;
      const awardId = p.awardId as string;

      // Same family as the bug #2 award/work check on bill create: an MB
      // must be issued against an award that actually belongs to the work,
      // otherwise a later bill could (via mbBelongsToBill) launder a
      // different work's measured value through this MB.
      const awardRows = await tx.select().from(awards)
        .where(and(eq(awards.tenantId, msg.tenantId), eq(awards.id, awardId)))
        .limit(1);
      const award = awardRows[0];
      if (!award) throw new NonRetryableError("AWARD_NOT_FOUND: award record not found for MB issue");
      if (!awardBelongsToWork(award, workId)) {
        throw new NonRetryableError("AWARD_WORK_MISMATCH: cited award does not belong to this work");
      }

      await tx.insert(measurementBooks).values({
        id: p.id as string,
        tenantId: msg.tenantId,
        workId,
        awardId,
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
      const workId = p.workId as string;
      const awardId = p.awardId as string;
      const mbId = p.mbId as string | undefined;

      // FR-BIL-012 + bug #2 (defense-in-depth — also enforced pre-enqueue in
      // billing/routes.ts): the cited award must exist AND actually belong
      // to the work being billed.
      const awardRows = await tx.select().from(awards)
        .where(and(eq(awards.tenantId, msg.tenantId), eq(awards.id, awardId)))
        .limit(1);
      const award = awardRows[0];
      if (!award) throw new NonRetryableError("AWARD_NOT_FOUND: award record not found for bill create");
      if (!awardBelongsToWork(award, workId)) {
        throw new NonRetryableError("AWARD_WORK_MISMATCH: cited award does not belong to this work");
      }

      // No-3-way-match gate (bug #1, defense-in-depth): a bill must reference
      // a real, finalized MB that belongs to this same work/award, and its
      // gross amount must not exceed the value of work actually measured
      // against that MB.
      if (!mbId) {
        throw new NonRetryableError("MB_REQUIRED: bill creation requires a valid mbId");
      }
      // Code-review fix (double-billing gap): lock the MB row for the rest
      // of this transaction. Without this, two concurrent billCreate
      // transactions citing the same mbId can each read "0 prior bills
      // against this MB", both pass the measured-value check below, and
      // both commit — double-billing the same measured work. FOR UPDATE
      // serializes them: the second transaction blocks here until the
      // first commits (or rolls back), then re-reads and sees the first
      // transaction's already-inserted bill, so its own prior-bills-by-mb
      // sum is correct and the check below closes the race. (This also
      // naturally serializes against a concurrent mbFinalize on the same
      // row, which takes an equivalent implicit lock via UPDATE.)
      const mbRows = await tx.select().from(measurementBooks)
        .where(and(eq(measurementBooks.tenantId, msg.tenantId), eq(measurementBooks.id, mbId)))
        .for("update")
        .limit(1);
      const mb = mbRows[0];
      if (!mb || !canCreateBill(mb.status)) {
        throw new NonRetryableError("MB_INVALID_STATUS: measurement book missing or not in allowed status for bill creation");
      }
      if (!mbBelongsToBill(mb, workId, awardId)) {
        throw new NonRetryableError("MB_WORK_MISMATCH: referenced measurement book does not belong to this work/award");
      }

      const mbMeasurements = await tx.select().from(measurements)
        .where(and(eq(measurements.tenantId, msg.tenantId), eq(measurements.mbId, mbId)));
      const boqItemIds = [...new Set(mbMeasurements.map((m) => m.boqItemId))];
      const boqRows = boqItemIds.length > 0
        ? await tx.select().from(boqItems)
            .where(and(eq(boqItems.tenantId, msg.tenantId), inArray(boqItems.id, boqItemIds)))
        : [];
      const rateByBoqItem = new Map(boqRows.map((b) => [b.id, b.rate]));
      const measuredValueMinor = computeMeasuredValueMinor(mbMeasurements, rateByBoqItem);

      const gross = parseMinor(p.grossAmountMinor as string | number | bigint);
      const deductions = parseMinor((p.deductionsMinor as string | number | bigint) ?? 0);
      const netPayable = calculateNetPayable(gross, deductions);

      // Code-review fix (double-billing gap): cumulative gross ALREADY
      // billed against this SAME mbId (prior bills) + this bill must not
      // exceed the MB's measured value — otherwise a second bill citing an
      // already-fully-billed MB recomputes the identical measured value and
      // passes independently. Read happens after the FOR UPDATE lock above,
      // so this sees every previously-committed bill against this MB.
      const priorBillsAgainstMb = await tx.select().from(bills)
        .where(and(eq(bills.tenantId, msg.tenantId), eq(bills.mbId, mbId)));
      const priorBilledAgainstMb = priorBillsAgainstMb.reduce(
        (sum, row) => sum + (row.grossAmountMinor ?? 0n),
        0n,
      );
      if (billAmountExceedsMeasuredValue(priorBilledAgainstMb, gross, measuredValueMinor)) {
        throw new NonRetryableError("MEASURED_VALUE_EXCEEDED: bill gross amount plus amount already billed against this MB exceeds the value of work measured against it");
      }

      // FR-BIL-012: cumulative gross billed amount must not exceed award ceiling.
      const priorBillRows = await tx.select().from(bills)
        .where(and(eq(bills.tenantId, msg.tenantId), eq(bills.workId, workId)));
      const priorBilledGross = priorBillRows.reduce(
        (sum, row) => sum + (row.grossAmountMinor ?? 0n),
        0n,
      );
      if (billAmountExceedsAward(priorBilledGross, gross, award.acceptedAmountMinor)) {
        throw new NonRetryableError("AWARD_CEILING_EXCEEDED: cumulative billed amount exceeds award ceiling");
      }

      const billId = p.id as string;
      await tx.insert(bills).values({
        id: billId,
        tenantId: msg.tenantId,
        workId,
        awardId,
        mbId,
        billMode: p.billMode as string,
        billNumber: p.billNumber as string,
        grossAmountMinor: gross,
        deductionsMinor: deductions,
        netPayableMinor: netPayable,
        status: "draft",
        createdBy: msg.actorId,
      });

      // No-3-way-match fix: populate bill_items from the MB's measurements —
      // a real, queryable link from bill → BoQ item → measured quantity,
      // not just a ceiling check.
      for (const m of mbMeasurements) {
        const rate = rateByBoqItem.get(m.boqItemId);
        if (rate === undefined) continue;
        const quantity = Number(m.quantity);
        await tx.insert(billItems).values({
          id: randomUUID(),
          tenantId: msg.tenantId,
          billId,
          boqItemId: m.boqItemId,
          quantity: String(quantity),
          rate,
          amountMinor: calculateBoqAmount(rate, quantity),
        });
      }

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
      const mbId = p.mbId as string;
      const boqItemId = p.boqItemId as string;
      const quantity = Number(p.quantity as number);

      const mbRows = await tx.select().from(measurementBooks)
        .where(and(eq(measurementBooks.tenantId, msg.tenantId), eq(measurementBooks.id, mbId)))
        .limit(1);
      const mb = mbRows[0];
      if (!mb) {
        throw new NonRetryableError("MB_NOT_FOUND: measurement references non-existent measurement book");
      }

      const boqRows = await tx.select().from(boqItems)
        .where(and(eq(boqItems.tenantId, msg.tenantId), eq(boqItems.id, boqItemId)))
        .limit(1);
      const boq = boqRows[0];
      if (!boq) {
        throw new NonRetryableError("INVALID_BOQ_REF: measurement references non-existent BoQ item");
      }

      // Bug fix (works-cross-entity-integrity #1, CRITICAL, defense-in-depth
      // — also enforced pre-enqueue in billing/routes.ts): the cited BoQ
      // item must belong to the same work as the MB it's being recorded
      // against. Without this, a caller can cite an unrelated work's BoQ
      // item (with its own rate) while recording against THIS work's MB,
      // laundering that borrowed rate into this MB's measured-value ceiling
      // — which bills against this work are later checked against.
      if (!boqItemBelongsToMbWork(boq, mb)) {
        throw new NonRetryableError("BOQ_WORK_MISMATCH: cited BoQ item does not belong to this MB's work");
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
