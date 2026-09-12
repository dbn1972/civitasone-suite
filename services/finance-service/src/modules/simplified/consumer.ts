/**
 * Simplified module SQS consumer — processes simplified accounting commands.
 *
 * For each command, it:
 * 1. Checks idempotency (markProcessed)
 * 2. Generates the GL journal via auto-journal
 * 3. Posts the journal into the GL schema (standard double-entry), guarded
 *    the same way gl/consumer.ts's postJournal guards a full-GL posting
 * 4. Records a simplified.transactions row (user-facing record)
 * 5. Emits an audit event via the outbox
 *
 * DOM-010 follow-up: this consumer used to insert straight into
 * finance_journals with none of gl/consumer.ts's three DOM-010 guards — no
 * leaf-account check, no period-status check at all, and an ad hoc
 * `SI-${Date.now()}-...` voucher scheme instead of a gapless sequence. An
 * independent review flagged it as a second, complete, parallel
 * journal-posting path that bypassed every protection DOM-010 added to
 * gl/consumer.ts's postJournal.
 *
 * It cannot simply call gl/consumer.ts's postJournal directly: simplified
 * mode resolves account codes against its OWN flat chart of accounts
 * (simplified.accounts, with its own code/parentCode/isGroup columns,
 * seeded from MSME_CHART_OF_ACCOUNTS) which is a completely separate table
 * from the full-GL chart postJournal's resolveHeadIdTx/hasChildHeadsTx query
 * (gl.finance_heads) — the two share no rows, so routing through postJournal
 * unmodified would throw UNKNOWN_ACCOUNT_CODE for every simplified posting.
 * postSimplifiedJournal below applies the same three guards independently,
 * in the same order as postJournal (period -> idempotency -> voucher ->
 * leaf), against simplified's own chart and its own finance_journals rows.
 */
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { financeJournals, financeJournalLines, type JournalLine } from "../gl/schema.js";
import { findJournalByIdTx } from "../gl/repo.js";
import { DomainError } from "../gl/domain.js";
import { getPeriodStatusTx } from "../period-close/repo.js";
import { nextVoucherNo, fyFromDate } from "../hoa/voucher.js";
import { simplifiedTransactions, type SimplifiedAccountRow } from "./schema.js";
import { findAccountByCodeTx } from "./repo.js";
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

type SimplifiedJournalInput = {
  journalId: string;
  tenantId: string;
  actorId: string;
  /** Short, stable series tag for the gapless voucher counter — one per
   *  transaction kind, matching the old ad hoc prefixes (SI/EXP/REC/PAY) for
   *  continuity. */
  series: string;
  type: string;
  postingDate: string;
  lines: JournalLine[];
};

/**
 * Posts one simplified-mode journal with the same three DOM-010 protections
 * gl/consumer.ts's postJournal applies to full-GL postings (see module
 * comment for why this can't just call postJournal itself). Returns the
 * allocated voucher number, or null if this call is an idempotent redelivery
 * of an already-posted journal — the caller must then skip its remaining
 * inserts (simplified_transactions + audit event), exactly like postJournal
 * returning early on an existing journal id.
 */
async function postSimplifiedJournal(
  tx: Parameters<typeof markProcessed>[0],
  input: SimplifiedJournalInput,
): Promise<string | null> {
  // DOM-010 (2) equivalent: fail closed on an unrecognized/malformed period
  // instead of ever treating it as open. getPeriodStatusTx only returns
  // "unknown" for a period that isn't even shaped like a real YYYY-MM period
  // — a well-formed period with no close record yet is still "open".
  const period = input.postingDate.slice(0, 7);
  const periodStatus = await getPeriodStatusTx(tx, input.tenantId, period);
  if (periodStatus === "unknown") {
    throw new DomainError("PERIOD_UNKNOWN", `cannot post to unrecognized period '${period}'`);
  }
  if (periodStatus === "hard_close") {
    throw new DomainError("PERIOD_CLOSED", `cannot post to hard-closed period ${period}`);
  }
  if (periodStatus === "soft_close") {
    // Simplified transactions are always ordinary business entries — never
    // adjustment/closing journals — so a soft-closed period blocks them
    // exactly as it blocks any other non-adjustment GL journal.
    throw new DomainError("PERIOD_SOFT_CLOSED", `only adjustment/closing journals allowed in soft-closed period ${period}`);
  }

  // DOM-010 (3) equivalent: idempotency short-circuit BEFORE voucher
  // allocation. journalId is client-supplied (the command's `id`) and used
  // verbatim as finance_journals.id — a redelivery (same journalId, new
  // messageId, e.g. a client retry after a timeout) must skip here, before
  // ever touching the gapless counter, or a retried request permanently
  // burns a voucher number for a journal that turns out to already exist.
  if (await findJournalByIdTx(tx, input.journalId)) return null;

  const fy = fyFromDate(input.postingDate);
  const { voucherNo } = await nextVoucherNo(tx, input.tenantId, fy, input.series);

  // DOM-010 (1) equivalent: reject posting to a group/summary account.
  // simplified.accounts marks groups with its own isGroup flag (unlike
  // gl.finance_heads, which infers "has children" from parentId) — same
  // intent, different mechanism, because it's a different chart of accounts.
  // A code with no row at all fails closed too: every code auto-journal.ts
  // can emit is a fixed constant that must exist in MSME_CHART_OF_ACCOUNTS,
  // so "not found" only happens for a tenant whose chart was never seeded —
  // silently posting against a nonexistent account is exactly the kind of
  // silent corruption DOM-010 exists to stop.
  const accountsByCode = new Map<string, SimplifiedAccountRow>();
  for (const line of input.lines) {
    const account = await findAccountByCodeTx(tx, input.tenantId, line.accountCode);
    if (!account) {
      throw new DomainError(
        "UNKNOWN_SIMPLIFIED_ACCOUNT_CODE",
        `account code '${line.accountCode}' not found in simplified chart of accounts for tenant ${input.tenantId}`,
      );
    }
    if (account.isGroup) {
      throw new DomainError(
        "NOT_LEAF_ACCOUNT",
        `cannot post to non-leaf account '${line.accountCode}' — it is a group account in the simplified chart of accounts`,
      );
    }
    accountsByCode.set(line.accountCode, account);
  }

  await tx.insert(financeJournals).values({
    id: input.journalId,
    tenantId: input.tenantId,
    voucherNo,
    type: input.type,
    postingDate: input.postingDate,
    lines: input.lines,
    status: "posted",
    createdBy: input.actorId,
    updatedBy: input.actorId,
  });

  for (const line of input.lines) {
    // Guaranteed present — populated in the validation pass above for every
    // line in input.lines.
    const account = accountsByCode.get(line.accountCode)!;
    await tx.insert(financeJournalLines).values({
      id: randomUUID(),
      tenantId: input.tenantId,
      journalId: input.journalId,
      headId: randomUUID(), // placeholder — simplified doesn't use head UUIDs
      debitMinor: BigInt(line.debitMinor),
      creditMinor: BigInt(line.creditMinor),
      narration: line.narration ?? null,
      postingDate: input.postingDate,
      journalType: input.type,
      headCode: line.accountCode,
      headName: account.name,
      headClassification: account.category,
    });
  }

  return voucherNo;
}

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

      const voucherNo = await postSimplifiedJournal(tx, {
        journalId, tenantId: p.tenantId, actorId: p.actorId,
        series: "SI", type: journal.type, postingDate: p.postingDate, lines: journal.lines,
      });
      if (voucherNo === null) return; // idempotent redelivery — already posted

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

      const voucherNo = await postSimplifiedJournal(tx, {
        journalId, tenantId: p.tenantId, actorId: p.actorId,
        series: "EXP", type: journal.type, postingDate: p.postingDate, lines: journal.lines,
      });
      if (voucherNo === null) return; // idempotent redelivery — already posted

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

      const voucherNo = await postSimplifiedJournal(tx, {
        journalId, tenantId: p.tenantId, actorId: p.actorId,
        series: "REC", type: journal.type, postingDate: p.postingDate, lines: journal.lines,
      });
      if (voucherNo === null) return; // idempotent redelivery — already posted

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

      const voucherNo = await postSimplifiedJournal(tx, {
        journalId, tenantId: p.tenantId, actorId: p.actorId,
        series: "PAY", type: journal.type, postingDate: p.postingDate, lines: journal.lines,
      });
      if (voucherNo === null) return; // idempotent redelivery — already posted

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
