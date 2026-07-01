/**
 * Auto-Journal Generator for simplified (MSME) accounting.
 *
 * When a small-office user records income, expenses, or payments, the system
 * AUTO-GENERATES proper double-entry GL journals without the user ever seeing
 * "debit", "credit", "journal", or "ledger".
 *
 * Internally, every simplified transaction maps to a balanced journal entry
 * posted through the same GL infrastructure that government tenants use.
 */

import type { JournalLine } from "../gl/schema.js";
import { assertJournalBalances } from "../gl/domain.js";
import { EXPENSE_CATEGORY_MAP } from "./seed.js";

/** Convert rupees (number with up to 2 decimals) to paise (bigint). */
export function rupeesToPaise(rupees: number): bigint {
  // Multiply by 100, round to avoid floating-point drift, then BigInt.
  return BigInt(Math.round(rupees * 100));
}

/** Convert paise (bigint) back to rupees for display. */
export function paiseToRupees(paise: bigint): number {
  return Number(paise) / 100;
}

export interface AutoJournalResult {
  lines: JournalLine[];
  type: string;
  narration: string;
}

/**
 * Sales Invoice created → Dr 1002 (Receivable), Cr 4001 (Sales), Cr 2002 (GST Payable)
 *
 * If GST rate is 0, only 2 lines: Dr Receivable, Cr Sales.
 */
export function generateSalesInvoiceJournal(params: {
  amountMinor: bigint;
  gstMinor: bigint;
  totalMinor: bigint;
  customerName?: string | undefined;
  invoiceNo?: string | undefined;
  incomeCode?: string | undefined;
}): AutoJournalResult {
  const { amountMinor, gstMinor, totalMinor, customerName, invoiceNo, incomeCode } = params;
  const salesCode = incomeCode ?? "4001";

  const lines: JournalLine[] = [
    { accountCode: "1002", debitMinor: totalMinor, creditMinor: 0n, narration: `Receivable from ${customerName ?? "customer"}` },
    { accountCode: salesCode, debitMinor: 0n, creditMinor: amountMinor, narration: `Sales income` },
  ];

  if (gstMinor > 0n) {
    lines.push({
      accountCode: "2002", debitMinor: 0n, creditMinor: gstMinor,
      narration: "GST payable on sales",
    });
  }

  assertJournalBalances(lines);

  return {
    lines,
    type: "receipt",
    narration: `Sales invoice${invoiceNo ? ` #${invoiceNo}` : ""} — ${customerName ?? "customer"}`,
  };
}

/**
 * Payment received → Dr 1001 (Cash/Bank), Cr 1002 (Receivable)
 */
export function generatePaymentReceivedJournal(params: {
  amountMinor: bigint;
  customerName?: string | undefined;
  invoiceNo?: string | undefined;
}): AutoJournalResult {
  const { amountMinor, customerName, invoiceNo } = params;

  const lines: JournalLine[] = [
    { accountCode: "1001", debitMinor: amountMinor, creditMinor: 0n, narration: `Payment received from ${customerName ?? "customer"}` },
    { accountCode: "1002", debitMinor: 0n, creditMinor: amountMinor, narration: `Settle receivable` },
  ];

  assertJournalBalances(lines);

  return {
    lines,
    type: "receipt",
    narration: `Payment received${invoiceNo ? ` for #${invoiceNo}` : ""} — ${customerName ?? "customer"}`,
  };
}

/**
 * Purchase recorded → Dr 5001 (COGS), Dr 2002 (GST input credit), Cr 2001 (Payable)
 *
 * GST on purchases is an INPUT CREDIT (asset), so we debit GST Payable (reducing liability).
 * In simplified mode, we use the same 2002 code for both output GST (credit on sales)
 * and input credit (debit on purchases). The net of this account gives the GST liability.
 */
export function generatePurchaseJournal(params: {
  amountMinor: bigint;
  gstMinor: bigint;
  totalMinor: bigint;
  vendorName?: string | undefined;
  description?: string | undefined;
}): AutoJournalResult {
  const { amountMinor, gstMinor, totalMinor, vendorName, description } = params;

  const lines: JournalLine[] = [
    { accountCode: "5001", debitMinor: amountMinor, creditMinor: 0n, narration: description ?? "Purchase / COGS" },
  ];

  if (gstMinor > 0n) {
    lines.push({
      accountCode: "2002", debitMinor: gstMinor, creditMinor: 0n,
      narration: "GST input credit on purchase",
    });
  }

  lines.push({
    accountCode: "2001", debitMinor: 0n, creditMinor: totalMinor,
    narration: `Payable to ${vendorName ?? "vendor"}`,
  });

  assertJournalBalances(lines);

  return {
    lines,
    type: "payment",
    narration: `Purchase — ${vendorName ?? "vendor"}${description ? `: ${description}` : ""}`,
  };
}

/**
 * Payment made → Dr 2001 (Payable), Cr 1001 (Cash/Bank)
 */
export function generatePaymentMadeJournal(params: {
  amountMinor: bigint;
  vendorName?: string | undefined;
  description?: string | undefined;
}): AutoJournalResult {
  const { amountMinor, vendorName, description } = params;

  const lines: JournalLine[] = [
    { accountCode: "2001", debitMinor: amountMinor, creditMinor: 0n, narration: `Pay ${vendorName ?? "vendor"}` },
    { accountCode: "1001", debitMinor: 0n, creditMinor: amountMinor, narration: `Cash/bank payment` },
  ];

  assertJournalBalances(lines);

  return {
    lines,
    type: "payment",
    narration: `Payment to ${vendorName ?? "vendor"}${description ? `: ${description}` : ""}`,
  };
}

/**
 * Expense recorded → Dr 50XX (expense head), Cr 1001 (Cash/Bank)
 *
 * If GST is applicable: Dr 50XX, Dr 2002 (input credit), Cr 1001 (total).
 */
export function generateExpenseJournal(params: {
  amountMinor: bigint;
  gstMinor: bigint;
  totalMinor: bigint;
  category: string;
  vendorName?: string | undefined;
  description?: string | undefined;
}): AutoJournalResult {
  const { amountMinor, gstMinor, totalMinor, category, vendorName, description } = params;

  const expenseCode = EXPENSE_CATEGORY_MAP[category] ?? "5009";

  const lines: JournalLine[] = [
    { accountCode: expenseCode, debitMinor: amountMinor, creditMinor: 0n, narration: description ?? category },
  ];

  if (gstMinor > 0n) {
    lines.push({
      accountCode: "2002", debitMinor: gstMinor, creditMinor: 0n,
      narration: "GST input credit",
    });
  }

  lines.push({
    accountCode: "1001", debitMinor: 0n, creditMinor: totalMinor,
    narration: `Paid by cash/bank`,
  });

  assertJournalBalances(lines);

  return {
    lines,
    type: "payment",
    narration: `Expense: ${category}${vendorName ? ` — ${vendorName}` : ""}${description ? `: ${description}` : ""}`,
  };
}

/**
 * Salary paid → Dr 5002 (Salary & Wages), Cr 1001 (Cash/Bank)
 */
export function generateSalaryJournal(params: {
  amountMinor: bigint;
  description?: string | undefined;
}): AutoJournalResult {
  const { amountMinor, description } = params;

  const lines: JournalLine[] = [
    { accountCode: "5002", debitMinor: amountMinor, creditMinor: 0n, narration: description ?? "Salary payment" },
    { accountCode: "1001", debitMinor: 0n, creditMinor: amountMinor, narration: "Cash/bank payment" },
  ];

  assertJournalBalances(lines);

  return {
    lines,
    type: "payment",
    narration: `Salary paid${description ? `: ${description}` : ""}`,
  };
}

/**
 * Resolve an expense category string (user-friendly) to an account code.
 * Falls back to "5009" (Other Expense) for unknown categories.
 */
export function resolveExpenseCode(category: string): string {
  const normalized = category.toLowerCase().replace(/[\s-]/g, "_");
  return EXPENSE_CATEGORY_MAP[normalized] ?? "5009";
}
