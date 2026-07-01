/**
 * Simplified module SQS consumer — processes simplified accounting commands.
 *
 * For each command, it:
 * 1. Checks idempotency (markProcessed)
 * 2. Generates the GL journal via auto-journal
 * 3. Inserts the journal into the GL schema (standard double-entry)
 * 4. Records a simplified.transactions row (user-facing record)
 * 5. Emits an audit event via the outbox
 */
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { financeJournals, financeJournalLines } from "../gl/schema.js";
import { simplifiedTransactions } from "./schema.js";
import { SIMPLIFIED_COMMANDS, SIMPLIFIED_EVENTS } from "./topics.js";
import {
  generateSalesInvoiceJournal,
  generatePaymentReceivedJournal,
  generateExpenseJournal,
  generatePaymentMadeJournal,
  resolveExpenseCode,
} from "./auto-journal.js";
import { randomUUID } from "node:crypto";

const AUDIT_TOPIC = "audit.event.record";

/** Income type → account code mapping */
const INCOME_TYPE_CODE: Record<string, string> = {
  sales: "4001",
  service: "4002",
  other: "4003",
};

export function registerSimplifiedConsumers(queue: Queue): void {
  // ─── Record Income ────────────────────────────────────────────────────
  queue.subscribe<{
    id: string;
    tenantId: string;
    actorId: string;
    amountMinor: string;
    gstMinor: string;
    totalMinor: string;
    customerName: string;
    description?: string;
    gstRate: number;
    invoiceNo?: string;
    incomeType: string;
    postingDate: string;
  }>(SIMPLIFIED_COMMANDS.recordIncome, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const amountMinor = BigInt(p.amountMinor);
      const gstMinor = BigInt(p.gstMinor);
      const totalMinor = BigInt(p.totalMinor);
      const incomeCode = INCOME_TYPE_CODE[p.incomeType] ?? "4001";

      const journal = generateSalesInvoiceJournal({
        amountMinor, gstMinor, totalMinor,
        customerName: p.customerName,
        invoiceNo: p.invoiceNo,
        incomeCode,
      });

      const journalId = p.id;
      const voucherNo = `SI-${Date.now()}-${journalId.slice(0, 8)}`;

      // Insert GL journal
      await tx.insert(financeJournals).values({
        id: journalId,
        tenantId: p.tenantId,
        voucherNo,
        type: journal.type,
        postingDate: p.postingDate,
        lines: journal.lines,
        status: "posted",
        createdBy: p.actorId,
        updatedBy: p.actorId,
      });

      // Insert denormalized journal lines
      for (const line of journal.lines) {
        await tx.insert(financeJournalLines).values({
          id: randomUUID(),
          tenantId: p.tenantId,
          journalId,
          headId: randomUUID(), // placeholder — simplified doesn't use head UUIDs
          debitMinor: BigInt(line.debitMinor),
          creditMinor: BigInt(line.creditMinor),
          narration: line.narration ?? null,
          postingDate: p.postingDate,
          journalType: journal.type,
          headCode: line.accountCode,
          headName: line.narration ?? null,
          headClassification: line.accountCode.startsWith("4") ? "income" :
            line.accountCode.startsWith("5") ? "expense" :
            line.accountCode.startsWith("1") ? "asset" : "liability",
        });
      }

      // Insert simplified transaction record
      await tx.insert(simplifiedTransactions).values({
        tenantId: p.tenantId,
        type: "sales_invoice",
        amountMinor,
        gstMinor,
        totalMinor,
        accountCode: incomeCode,
        counterParty: p.customerName,
        description: p.description ?? null,
        invoiceNo: p.invoiceNo ?? null,
        journalId,
        postingDate: p.postingDate,
        createdBy: p.actorId,
        updatedBy: p.actorId,
      });

      // Audit
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: SIMPLIFIED_EVENTS.incomeRecorded,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "finance",
          action: "simplified_record_income",
          resourceType: "simplified_transaction",
          resourceId: journalId,
          outcome: "success",
          amountMinor: p.totalMinor,
          customerName: p.customerName,
        },
      });
    });
  });

  // ─── Record Expense ───────────────────────────────────────────────────
  queue.subscribe<{
    id: string;
    tenantId: string;
    actorId: string;
    amountMinor: string;
    gstMinor: string;
    totalMinor: string;
    category: string;
    vendorName?: string;
    description?: string;
    gstRate: number;
    postingDate: string;
  }>(SIMPLIFIED_COMMANDS.recordExpense, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const amountMinor = BigInt(p.amountMinor);
      const gstMinor = BigInt(p.gstMinor);
      const totalMinor = BigInt(p.totalMinor);

      const journal = generateExpenseJournal({
        amountMinor, gstMinor, totalMinor,
        category: p.category,
        vendorName: p.vendorName,
        description: p.description,
      });

      const journalId = p.id;
      const voucherNo = `EXP-${Date.now()}-${journalId.slice(0, 8)}`;

      await tx.insert(financeJournals).values({
        id: journalId,
        tenantId: p.tenantId,
        voucherNo,
        type: journal.type,
        postingDate: p.postingDate,
        lines: journal.lines,
        status: "posted",
        createdBy: p.actorId,
        updatedBy: p.actorId,
      });

      for (const line of journal.lines) {
        await tx.insert(financeJournalLines).values({
          id: randomUUID(),
          tenantId: p.tenantId,
          journalId,
          headId: randomUUID(),
          debitMinor: BigInt(line.debitMinor),
          creditMinor: BigInt(line.creditMinor),
          narration: line.narration ?? null,
          postingDate: p.postingDate,
          journalType: journal.type,
          headCode: line.accountCode,
          headName: line.narration ?? null,
          headClassification: line.accountCode.startsWith("5") ? "expense" :
            line.accountCode.startsWith("2") ? "liability" : "asset",
        });
      }

      const expenseCode = resolveExpenseCode(p.category);

      await tx.insert(simplifiedTransactions).values({
        tenantId: p.tenantId,
        type: "expense_recorded",
        amountMinor,
        gstMinor,
        totalMinor,
        accountCode: expenseCode,
        counterParty: p.vendorName ?? null,
        description: p.description ?? null,
        invoiceNo: null,
        journalId,
        postingDate: p.postingDate,
        createdBy: p.actorId,
        updatedBy: p.actorId,
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: SIMPLIFIED_EVENTS.expenseRecorded,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "finance",
          action: "simplified_record_expense",
          resourceType: "simplified_transaction",
          resourceId: journalId,
          outcome: "success",
          amountMinor: p.totalMinor,
          category: p.category,
        },
      });
    });
  });

  // ─── Record Payment Received ──────────────────────────────────────────
  queue.subscribe<{
    id: string;
    tenantId: string;
    actorId: string;
    amountMinor: string;
    customerName: string;
    invoiceNo?: string;
    postingDate: string;
  }>(SIMPLIFIED_COMMANDS.recordPaymentReceived, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const amountMinor = BigInt(p.amountMinor);

      const journal = generatePaymentReceivedJournal({
        amountMinor,
        customerName: p.customerName,
        invoiceNo: p.invoiceNo,
      });

      const journalId = p.id;
      const voucherNo = `REC-${Date.now()}-${journalId.slice(0, 8)}`;

      await tx.insert(financeJournals).values({
        id: journalId,
        tenantId: p.tenantId,
        voucherNo,
        type: journal.type,
        postingDate: p.postingDate,
        lines: journal.lines,
        status: "posted",
        createdBy: p.actorId,
        updatedBy: p.actorId,
      });

      for (const line of journal.lines) {
        await tx.insert(financeJournalLines).values({
          id: randomUUID(),
          tenantId: p.tenantId,
          journalId,
          headId: randomUUID(),
          debitMinor: BigInt(line.debitMinor),
          creditMinor: BigInt(line.creditMinor),
          narration: line.narration ?? null,
          postingDate: p.postingDate,
          journalType: journal.type,
          headCode: line.accountCode,
          headName: line.narration ?? null,
          headClassification: line.accountCode.startsWith("1") ? "asset" : "liability",
        });
      }

      await tx.insert(simplifiedTransactions).values({
        tenantId: p.tenantId,
        type: "payment_received",
        amountMinor,
        gstMinor: 0n,
        totalMinor: amountMinor,
        accountCode: "1001",
        counterParty: p.customerName,
        description: null,
        invoiceNo: p.invoiceNo ?? null,
        journalId,
        postingDate: p.postingDate,
        createdBy: p.actorId,
        updatedBy: p.actorId,
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: SIMPLIFIED_EVENTS.paymentReceived,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "finance",
          action: "simplified_record_payment_received",
          resourceType: "simplified_transaction",
          resourceId: journalId,
          outcome: "success",
          amountMinor: p.amountMinor,
          customerName: p.customerName,
        },
      });
    });
  });

  // ─── Record Payment Made ──────────────────────────────────────────────
  queue.subscribe<{
    id: string;
    tenantId: string;
    actorId: string;
    amountMinor: string;
    vendorName: string;
    description?: string;
    postingDate: string;
  }>(SIMPLIFIED_COMMANDS.recordPaymentMade, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const amountMinor = BigInt(p.amountMinor);

      const journal = generatePaymentMadeJournal({
        amountMinor,
        vendorName: p.vendorName,
        description: p.description,
      });

      const journalId = p.id;
      const voucherNo = `PAY-${Date.now()}-${journalId.slice(0, 8)}`;

      await tx.insert(financeJournals).values({
        id: journalId,
        tenantId: p.tenantId,
        voucherNo,
        type: journal.type,
        postingDate: p.postingDate,
        lines: journal.lines,
        status: "posted",
        createdBy: p.actorId,
        updatedBy: p.actorId,
      });

      for (const line of journal.lines) {
        await tx.insert(financeJournalLines).values({
          id: randomUUID(),
          tenantId: p.tenantId,
          journalId,
          headId: randomUUID(),
          debitMinor: BigInt(line.debitMinor),
          creditMinor: BigInt(line.creditMinor),
          narration: line.narration ?? null,
          postingDate: p.postingDate,
          journalType: journal.type,
          headCode: line.accountCode,
          headName: line.narration ?? null,
          headClassification: line.accountCode.startsWith("1") ? "asset" : "liability",
        });
      }

      await tx.insert(simplifiedTransactions).values({
        tenantId: p.tenantId,
        type: "payment_made",
        amountMinor,
        gstMinor: 0n,
        totalMinor: amountMinor,
        accountCode: "2001",
        counterParty: p.vendorName,
        description: p.description ?? null,
        invoiceNo: null,
        journalId,
        postingDate: p.postingDate,
        createdBy: p.actorId,
        updatedBy: p.actorId,
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: SIMPLIFIED_EVENTS.paymentMade,
        tenantId: p.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "finance",
          action: "simplified_record_payment_made",
          resourceType: "simplified_transaction",
          resourceId: journalId,
          outcome: "success",
          amountMinor: p.amountMinor,
          vendorName: p.vendorName,
        },
      });
    });
  });
}
