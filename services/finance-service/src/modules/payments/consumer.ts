import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as budgetRepo from "../budget/repo.js";
import { assertThreeWayMatchPresent, assertBillPassed, assertValidPaymentMode, nextStage } from "./domain.js";
import { assertSanctionNotExhausted, assertValidPfmsHoA } from "../budget/domain.js";
import { assertValidDdoCode } from "../../shared/pfms.js";
import type { Deduction } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerPaymentsConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.billCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; billNo: string; vendorId: string; headId: string;
      ddoCode: string;
      sanctionRef?: string; grossMinor: number; currency?: string; deductions: Deduction[];
      netMinor: number; poRef?: string; grnRef?: string;
    };
    assertValidDdoCode(p.ddoCode);
    const hasMismatch = !p.poRef || !p.grnRef;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const head = await budgetRepo.findHeadByIdTx(tx, p.headId);
      if (head) assertValidPfmsHoA(head.hoaCode);
      // P0 fix: enforce sanction balance before inserting the bill
      if (p.sanctionRef) {
        const sanction = await budgetRepo.findSanctionByIdTx(tx, p.sanctionRef);
        if (sanction) {
          assertSanctionNotExhausted(
            { amountMinor: sanction.amountMinor, utilisedMinor: sanction.utilisedMinor },
            BigInt(p.netMinor),
          );
        }
      }
      await repo.insertBill(tx, {
        id: p.id, tenantId: p.tenantId, billNo: p.billNo, vendorId: p.vendorId,
        headId: p.headId, ddoCode: p.ddoCode.toUpperCase(), sanctionRef: p.sanctionRef ?? null,
        grossMinor: BigInt(p.grossMinor), currency: p.currency ?? "INR",
        deductions: p.deductions, netMinor: BigInt(p.netMinor),
        poRef: p.poRef ?? null, grnRef: p.grnRef ?? null,
        stage: "section", status: hasMismatch ? "on_hold" : "pending",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      if (hasMismatch) {
        await enqueue(tx, {
          topic: EVENTS.billMismatch, eventType: EVENTS.billMismatch,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { billId: p.id, billNo: p.billNo, reason: "missing po_ref or grn_ref" },
        });
      }
      await audit(tx, msg, "create", "bill", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "bill", p.id));
  });

  queue.subscribe(COMMANDS.billApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; notes?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const bill = await repo.findBillByIdTx(tx, p.id);
      if (!bill) throw new Error(`bill ${p.id} not found`);
      // 3-way match must be valid before passing
      assertThreeWayMatchPresent(bill.poRef, bill.grnRef);
      const currentStage = bill.stage ?? "section";
      const newStage = nextStage(currentStage);
      const isPassed = newStage === "pay";
      await repo.updateBill(tx, p.id, {
        stage: newStage,
        status: isPassed ? "passed" : "pending",
        updatedBy: msg.actorId,
        version: (bill.version ?? 1) + 1,
      });
      if (isPassed) {
        await enqueue(tx, {
          topic: EVENTS.billPassed, eventType: EVENTS.billPassed,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { billId: p.id, vendorId: bill.vendorId, netMinor: bill.netMinor.toString() },
        });
      }
      await audit(tx, msg, "approve", "bill", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "bill", p.id));
  });

  queue.subscribe(COMMANDS.paymentInitiate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; billId: string; ddoCode: string; mode: string;
      amountMinor: number; currency?: string; eftRef?: string;
    };
    assertValidDdoCode(p.ddoCode);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const bill = await repo.findBillByIdTx(tx, p.billId);
      if (!bill) throw new Error(`bill ${p.billId} not found`);
      if (bill.ddoCode && bill.ddoCode !== p.ddoCode.toUpperCase()) {
        throw new Error(`DDO code mismatch: bill has ${bill.ddoCode}, payment has ${p.ddoCode}`);
      }
      assertBillPassed(bill.status ?? "pending");
      assertValidPaymentMode(p.mode);
      await repo.insertPayment(tx, {
        id: p.id, tenantId: p.tenantId, billId: p.billId,
        ddoCode: p.ddoCode.toUpperCase(),
        eftRef: p.eftRef ?? null, mode: p.mode,
        amountMinor: BigInt(p.amountMinor), currency: p.currency ?? "INR",
        status: "initiated", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.updateBill(tx, p.billId, { status: "paid", updatedBy: msg.actorId });
      await enqueue(tx, {
        topic: EVENTS.paymentMade, eventType: EVENTS.paymentMade,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { paymentId: p.id, billId: p.billId, amountMinor: p.amountMinor, mode: p.mode },
      });
      await audit(tx, msg, "initiate", "payment", p.id);
    });
    await cache.put(cache.makeKey(msg.tenantId, "payment", p.id), { id: p.id, status: "initiated" });
  });

  queue.subscribe(COMMANDS.gemInvoiceMatch, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; poRef: string; invoiceRef: string; amountMinor: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Record in outbox — downstream bill creation handles the actual 3-way match
      await enqueue(tx, {
        topic: "finance.gem.invoice.matched", eventType: "finance.gem.invoice.matched",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { poRef: p.poRef, invoiceRef: p.invoiceRef, amountMinor: p.amountMinor },
      });
      await audit(tx, msg, "gem_match", "gem_invoice", p.id);
    });
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
