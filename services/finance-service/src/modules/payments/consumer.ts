import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as budgetRepo from "../budget/repo.js";
import { assertThreeWayMatchPresent, assertBillPassed, assertValidPaymentMode, nextStage } from "./domain.js";
import { assertValidDdoCode } from "../../shared/pfms.js";
import { assertValidHoAWithMaster } from "../hoa/domain.js";
import { ddoExists, paoExists } from "../masters/repo.js";
import { getPeriodStatus } from "../period-close/routes.js";
import * as allocRepo from "../budget/allocation-repo.js";
import { fyFromDate } from "../hoa/voucher.js";
import type { Deduction } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerPaymentsConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.billCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; billNo: string; vendorId: string; headId: string;
      ddoCode: string; paoCode?: string;
      sanctionRef?: string; grossMinor: number; currency?: string; deductions: Deduction[];
      netMinor: number; poRef?: string; grnRef?: string; billDate?: string;
    };
    assertValidDdoCode(p.ddoCode);
    const hasMismatch = !p.poRef || !p.grnRef;
    // C3: derive the period from the bill's OWN posting/value date, not wall-clock.
    // The bill carries an optional billDate (YYYY-MM-DD); when absent we fall back
    // to today (the create date), mirroring gl/consumer.ts which uses the document date.
    const billDate = (p.billDate && /^\d{4}-\d{2}-\d{2}$/.test(p.billDate))
      ? p.billDate
      : new Date().toISOString().slice(0, 10);
    const billPeriod = billDate.slice(0, 7);
    const netMinor = BigInt(p.netMinor);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const head = await budgetRepo.findHeadByIdTx(tx, p.headId);
      const reader = tx as unknown as Parameters<typeof ddoExists>[2];
      // M3: a referenced head that does not resolve for this tenant is a hard error,
      // not a silently-skipped control. (headId is always referenced on a bill.)
      if (!head || head.tenantId !== p.tenantId) {
        throw new Error(`UNKNOWN_HEAD: ${p.headId} not found in budget head master for tenant`);
      }
      // HoA: well-formed 18-digit segmentation + major head exists in master
      await assertValidHoAWithMaster(head.hoaCode, reader);
      // DDO/PAO must exist in the per-tenant master (when provided)
      if (!(await ddoExists(p.tenantId, p.ddoCode.toUpperCase(), reader))) {
        throw new Error(`UNKNOWN_DDO: ${p.ddoCode} not found in DDO master`);
      }
      if (p.paoCode && !(await paoExists(p.tenantId, p.paoCode.toUpperCase(), reader))) {
        throw new Error(`UNKNOWN_PAO: ${p.paoCode} not found in PAO master`);
      }
      // M3: if a sanction is REFERENCED, it must resolve for this tenant. A bill
      // citing a bogus/other-tenant sanctionRef must NOT bypass the balance check.
      let sanction: Awaited<ReturnType<typeof budgetRepo.findSanctionByIdTx>> = null;
      if (p.sanctionRef) {
        sanction = await budgetRepo.findSanctionByIdTx(tx, p.sanctionRef);
        if (!sanction || sanction.tenantId !== p.tenantId) {
          throw new Error(`UNKNOWN_SANCTION: ${p.sanctionRef} not found for tenant`);
        }
      }
      // Period hard-close: block bill posting into a hard-closed period (bill's own date).
      if ((await getPeriodStatus(p.tenantId, billPeriod)) === "hard_close") {
        throw new Error(`PERIOD_CLOSED: cannot post bill into hard-closed period ${billPeriod}`);
      }
      // Budget appropriation control: locate the head allocation for the bill's FY.
      const billFy = fyFromDate(billDate);
      const alloc = await allocRepo.findAllocationTx(tx, p.tenantId, p.headId, billFy);
      await repo.insertBill(tx, {
        id: p.id, tenantId: p.tenantId, billNo: p.billNo, vendorId: p.vendorId,
        headId: p.headId, ddoCode: p.ddoCode.toUpperCase(),
        ...(p.paoCode ? { paoCode: p.paoCode.toUpperCase() } : {}),
        sanctionRef: p.sanctionRef ?? null,
        grossMinor: BigInt(p.grossMinor), currency: p.currency ?? "INR",
        deductions: p.deductions, netMinor,
        poRef: p.poRef ?? null, grnRef: p.grnRef ?? null,
        billDate,
        stage: "section", status: hasMismatch ? "on_hold" : "pending",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      // C1: register the commitment with a single atomic guarded UPDATE. Two
      // concurrent bills can no longer both pass a stale read — the conditional
      // WHERE serialises them; the loser gets rowcount=0 and is rejected.
      if (alloc) {
        const ok = await allocRepo.addCommittedGuarded(tx, alloc.id, netMinor);
        if (!ok) {
          throw new Error(`OVER_APPROPRIATION: bill ${netMinor} paise exceeds available appropriation for head ${p.headId} (${billFy})`);
        }
      }
      // C2: increment sanction utilised via guarded SQL expression (no read-then-set,
      // no lost update). Loser of a concurrent race gets rowcount=0 → rejected.
      if (sanction) {
        const ok = await budgetRepo.incrementSanctionUtilisedGuarded(tx, sanction.id, netMinor, msg.actorId);
        if (!ok) {
          throw new Error(`SANCTION_EXHAUSTED: bill ${netMinor} paise exceeds sanction balance for ${p.sanctionRef}`);
        }
      }
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
      // C3: derive the period from the underlying bill's own value/posting date,
      // not wall-clock. Falls back to the bill's create date if no billDate set.
      const payDate = (bill.billDate ?? new Date(bill.createdAt).toISOString().slice(0, 10));
      const payPeriod = payDate.slice(0, 7);
      if ((await getPeriodStatus(p.tenantId, payPeriod)) === "hard_close") {
        throw new Error(`PERIOD_CLOSED: cannot post payment into hard-closed period ${payPeriod}`);
      }
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
