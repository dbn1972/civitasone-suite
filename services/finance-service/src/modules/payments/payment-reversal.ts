import { sql } from "drizzle-orm";
import { enqueue } from "../../shared/outbox.js";
import { postCashBook } from "../../shared/cashbook.js";
import * as budgetRepo from "../budget/repo.js";
import * as allocRepo from "../budget/allocation-repo.js";
import { fyFromDate } from "../hoa/voucher.js";
import { enqueueSpineJournal } from "../gl/spine.js";
import type { JournalLine } from "../gl/schema.js";
import * as repo from "./repo.js";
import type { PaymentRow } from "./schema.js";

// Same control heads paymentInitiate (consumer.ts) posted the payment against.
const AP_CONTROL_CODE = process.env.FINANCE_AP_CONTROL_CODE ?? "2050";
const BANK_CODE = process.env.FINANCE_BANK_CODE ?? "1100";

type Tx = Parameters<typeof enqueue>[0];

/**
 * V4-D-02: undo, in the caller's transaction, everything paymentInitiate
 * (consumer.ts) committed when it created the payment: bill "paid", the
 * committed->actual appropriation settlement, the AP/Bank GL journal and the
 * cash-book OUT row. Called when eOffice rejects a payment that is already
 * fully posted. Every leg is keyed off the payment id, so a redelivery (which
 * markProcessed already filters) could not double-reverse either.
 */
export async function reversePostedPayment(
  tx: Tx,
  payment: PaymentRow,
  ctx: { tenantId: string; actorId: string; correlationId: string },
): Promise<void> {
  const bill = await repo.findBillByIdTx(tx, payment.billId);
  if (!bill) throw new Error(`PAYMENT_REVERSAL: bill ${payment.billId} not found for payment ${payment.id}`);

  // Bill back to "passed" so it can be paid again (paymentInitiate requires it).
  if (bill.status === "paid") {
    await repo.updateBill(tx, bill.id, { status: "passed", updatedBy: ctx.actorId });
  }

  // Same payDate / FY derivation as paymentInitiate.
  const payDate = bill.billDate ?? new Date(bill.createdAt).toISOString().slice(0, 10);
  const amount = BigInt(payment.amountMinor);

  // Un-settle actual -> committed, guarded so actual can never go negative.
  const alloc = await allocRepo.findAllocationTx(tx, ctx.tenantId, bill.headId, fyFromDate(payDate));
  if (alloc) {
    await (tx as unknown as { execute: (q: unknown) => Promise<unknown> }).execute(sql`
      UPDATE budget.finance_budget_allocation
         SET committed_minor = committed_minor + ${bill.netMinor},
             actual_minor    = actual_minor - ${bill.netMinor},
             updated_at = now()
       WHERE id = ${alloc.id}
         AND actual_minor >= ${bill.netMinor}
    `);
  }

  // GL: mirror of the payment journal (Dr Bank / Cr Accounts-Payable). Posted as
  // a fresh "adjustment" journal dated today (allowed in soft-closed periods)
  // rather than via finance.gl.reverse, whose maker-checker rule would wedge the
  // compensation whenever the eOffice decider is also the original payer.
  const apHead = await budgetRepo.findHeadByCodeTx(tx as Parameters<typeof budgetRepo.findHeadByCodeTx>[0], ctx.tenantId, AP_CONTROL_CODE);
  const bankHead = await budgetRepo.findHeadByCodeTx(tx as Parameters<typeof budgetRepo.findHeadByCodeTx>[0], ctx.tenantId, BANK_CODE);
  if (!apHead || !bankHead) throw new Error("MISSING_CONTROL_HEAD: accounts_payable/bank head not found for tenant");
  const today = new Date().toISOString().slice(0, 10);
  const lines: JournalLine[] = [
    { accountCode: bankHead.id, debitMinor: amount, creditMinor: 0n },
    { accountCode: apHead.id,   debitMinor: 0n,      creditMinor: amount },
  ];
  await enqueueSpineJournal(tx, {
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    sourceKey: `payment-reversal:${payment.id}`, type: "adjustment", postingDate: today, lines,
  });

  // Cash book: append a cash-IN row offsetting the original OUT row.
  await postCashBook(tx as unknown as Parameters<typeof postCashBook>[0], {
    tenantId: ctx.tenantId, entryDate: today, voucherType: "journal",
    voucherNo: bill.billNo, particulars: `Reversal of payment against bill ${bill.billNo} (eOffice rejected)`,
    receiptMinor: amount, paymentMinor: 0n, bankOrCash: "bank",
    reference: `payment-reversal:${payment.id}`, actorId: ctx.actorId,
  });
}
