/**
 * Revenue & Billing → Finance integration consumer.
 *
 * Closes B7: revenue.receipt.captured and billing.invoice.issued/paid events
 * were previously published but had no finance-service subscriber, so revenue
 * collections and SaaS billing never posted to the General Ledger.
 *
 * Each handler follows the standard pattern:
 *   markProcessed → build balanced journal lines → publish journalPost command → audit.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, CONSUMED_EVENTS } from "../../topics.js";
import { pino } from "pino";

const AUDIT_TOPIC = "audit.event.record";
const log = pino({ name: "finance:revenue-billing-consumer" });

// Default account codes (configurable via env for tenant-specific CoA mapping)
const REVENUE_CASH = process.env.FINANCE_REVENUE_CASH_CODE ?? "1100";
const REVENUE_INCOME = process.env.FINANCE_REVENUE_INCOME_CODE ?? "4001";
const REVENUE_REFUND_EXPENSE = process.env.FINANCE_REVENUE_REFUND_CODE ?? "5200";
const BILLING_RECEIVABLE = process.env.FINANCE_BILLING_RECEIVABLE_CODE ?? "1300";
const BILLING_REVENUE = process.env.FINANCE_BILLING_REVENUE_CODE ?? "4010";
const BILLING_CASH = process.env.FINANCE_BILLING_CASH_CODE ?? "1100";

export function registerRevenueBillingConsumers(queue: Queue): void {
  /**
   * revenue.receipt.captured → post collections journal (Dr Cash, Cr Revenue Income).
   */
  queue.subscribe(CONSUMED_EVENTS.revenueReceiptCaptured, async (msg: CommandEnvelope) => {
    const p = msg.payload as {
      receiptId: string;
      assesseeId?: string;
      headId?: string;
      amountMinor: string | number;
      currency?: string;
      receiptDate?: string;
    };
    const amount = BigInt(p.amountMinor);
    const journalId = randomUUID();

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await enqueue(tx, {
        topic: COMMANDS.journalPost,
        eventType: COMMANDS.journalPost,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: journalId,
          tenantId: msg.tenantId,
          voucherNo: `RCV/${p.receiptId.slice(0, 8).toUpperCase()}`,
          type: "revenue_receipt",
          postingDate: p.receiptDate ?? new Date().toISOString().slice(0, 10),
          lines: [
            { accountCode: REVENUE_CASH, debitMinor: amount.toString(), creditMinor: "0", narration: `Revenue receipt ${p.receiptId}` },
            { accountCode: p.headId ?? REVENUE_INCOME, debitMinor: "0", creditMinor: amount.toString(), narration: `Revenue income ${p.receiptId}` },
          ],
        },
      });

      await audit(tx, msg, "revenue_receipt_posted", "revenue_receipt", p.receiptId);
      log.info({ receiptId: p.receiptId, amountMinor: amount.toString(), tenantId: msg.tenantId }, "revenue receipt posted to GL");
    });
  });

  /**
   * revenue.refund.processed → post refund journal (Dr Refund Expense, Cr Cash).
   */
  queue.subscribe(CONSUMED_EVENTS.revenueRefundProcessed, async (msg: CommandEnvelope) => {
    const p = msg.payload as {
      refundId: string;
      receiptId?: string;
      amountMinor: string | number;
      currency?: string;
      processedDate?: string;
    };
    const amount = BigInt(p.amountMinor);
    const journalId = randomUUID();

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await enqueue(tx, {
        topic: COMMANDS.journalPost,
        eventType: COMMANDS.journalPost,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: journalId,
          tenantId: msg.tenantId,
          voucherNo: `RFD/${p.refundId.slice(0, 8).toUpperCase()}`,
          type: "revenue_refund",
          postingDate: p.processedDate ?? new Date().toISOString().slice(0, 10),
          lines: [
            { accountCode: REVENUE_REFUND_EXPENSE, debitMinor: amount.toString(), creditMinor: "0", narration: `Revenue refund ${p.refundId}` },
            { accountCode: REVENUE_CASH, debitMinor: "0", creditMinor: amount.toString(), narration: `Cash refunded ${p.refundId}` },
          ],
        },
      });

      await audit(tx, msg, "revenue_refund_posted", "revenue_refund", p.refundId);
      log.info({ refundId: p.refundId, amountMinor: amount.toString(), tenantId: msg.tenantId }, "revenue refund posted to GL");
    });
  });

  /**
   * billing.invoice.issued → recognize SaaS revenue (Dr Receivable, Cr Revenue).
   */
  queue.subscribe(CONSUMED_EVENTS.billingInvoiceIssued, async (msg: CommandEnvelope) => {
    const p = msg.payload as {
      invoiceId: string;
      subscriptionId?: string;
      totalMinor: string | number;
      currency?: string;
      issuedDate?: string;
    };
    const amount = BigInt(p.totalMinor);
    const journalId = randomUUID();

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await enqueue(tx, {
        topic: COMMANDS.journalPost,
        eventType: COMMANDS.journalPost,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: journalId,
          tenantId: msg.tenantId,
          voucherNo: `INV/${p.invoiceId.slice(0, 8).toUpperCase()}`,
          type: "billing_revenue_recognition",
          postingDate: p.issuedDate ?? new Date().toISOString().slice(0, 10),
          lines: [
            { accountCode: BILLING_RECEIVABLE, debitMinor: amount.toString(), creditMinor: "0", narration: `Invoice receivable ${p.invoiceId}` },
            { accountCode: BILLING_REVENUE, debitMinor: "0", creditMinor: amount.toString(), narration: `SaaS revenue ${p.invoiceId}` },
          ],
        },
      });

      await audit(tx, msg, "billing_invoice_recognized", "billing_invoice", p.invoiceId);
      log.info({ invoiceId: p.invoiceId, amountMinor: amount.toString(), tenantId: msg.tenantId }, "billing invoice recognized in GL");
    });
  });

  /**
   * billing.invoice.paid → post cash receipt (Dr Cash, Cr Receivable).
   */
  queue.subscribe(CONSUMED_EVENTS.billingInvoicePaid, async (msg: CommandEnvelope) => {
    const p = msg.payload as {
      invoiceId: string;
      paidMinor: string | number;
      currency?: string;
      paidDate?: string;
    };
    const amount = BigInt(p.paidMinor);
    const journalId = randomUUID();

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await enqueue(tx, {
        topic: COMMANDS.journalPost,
        eventType: COMMANDS.journalPost,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: journalId,
          tenantId: msg.tenantId,
          voucherNo: `RCPT/${p.invoiceId.slice(0, 8).toUpperCase()}`,
          type: "billing_cash_receipt",
          postingDate: p.paidDate ?? new Date().toISOString().slice(0, 10),
          lines: [
            { accountCode: BILLING_CASH, debitMinor: amount.toString(), creditMinor: "0", narration: `Payment received ${p.invoiceId}` },
            { accountCode: BILLING_RECEIVABLE, debitMinor: "0", creditMinor: amount.toString(), narration: `Receivable cleared ${p.invoiceId}` },
          ],
        },
      });

      await audit(tx, msg, "billing_payment_received", "billing_invoice", p.invoiceId);
      log.info({ invoiceId: p.invoiceId, paidMinor: amount.toString(), tenantId: msg.tenantId }, "billing payment posted to GL");
    });
  });
}

async function audit(
  tx: Parameters<typeof markProcessed>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string, resourceType: string, resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
