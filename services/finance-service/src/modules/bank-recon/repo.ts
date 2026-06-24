import { eq, and, or, isNull, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  bankStatement, bankStatementLines,
  type BankStatementRow, type BankStatementInsert, type BankStatementLineRow,
} from "./schema.js";
import { financePayments } from "../payments/schema.js";
import { financeChallans } from "../treasury/schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertStatement(tx: Writer, row: BankStatementInsert): Promise<void> {
  await tx.insert(bankStatement).values(row);
}

export async function insertLine(tx: Writer, row: typeof bankStatementLines.$inferInsert): Promise<void> {
  await tx.insert(bankStatementLines).values(row);
}

export async function findStatement(id: string, tenantId: string): Promise<BankStatementRow | null> {
  const rows = await db.select().from(bankStatement)
    .where(and(eq(bankStatement.id, id), eq(bankStatement.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function linesForStatement(tx: Writer, statementId: string): Promise<BankStatementLineRow[]> {
  return (tx as typeof db).select().from(bankStatementLines)
    .where(eq(bankStatementLines.statementId, statementId));
}

export async function listStatements(tenantId: string, limit: number) {
  return db.select().from(bankStatement)
    .where(eq(bankStatement.tenantId, tenantId)).limit(limit);
}

/**
 * Unreconciled payments (money out) for a tenant — match against debit statement
 * lines. H2: when `bankAccountId` is supplied (the statement's own account) the
 * candidate set is scoped so a payment tagged to a DIFFERENT bank account cannot
 * match this statement's lines. Payments with a NULL bank_account_id stay
 * eligible (legacy/untagged), preserving prior behaviour.
 */
export async function unreconciledPayments(tenantId: string, bankAccountId?: string) {
  return db.select({
    id: financePayments.id,
    amountMinor: financePayments.amountMinor,
    date: sql<string>`to_char(${financePayments.createdAt}, 'YYYY-MM-DD')`,
    reference: financePayments.utr,
  }).from(financePayments)
    .where(and(
      eq(financePayments.tenantId, tenantId),
      eq(financePayments.reconciled, false),
      ...(bankAccountId
        ? [or(isNull(financePayments.bankAccountId), eq(financePayments.bankAccountId, bankAccountId))!]
        : []),
    ));
}

/**
 * Unreconciled challans/receipts (money in) — match against credit statement
 * lines. H2: scoped to the statement's bank account when supplied; untagged
 * (NULL) challans remain eligible.
 */
export async function unreconciledChallans(tenantId: string, bankAccountId?: string) {
  return db.select({
    id: financeChallans.id,
    amountMinor: financeChallans.amountMinor,
    date: sql<string>`to_char(${financeChallans.createdAt}, 'YYYY-MM-DD')`,
    reference: financeChallans.challanNo,
  }).from(financeChallans)
    .where(and(
      eq(financeChallans.tenantId, tenantId),
      eq(financeChallans.reconciled, false),
      ...(bankAccountId
        ? [or(isNull(financeChallans.bankAccountId), eq(financeChallans.bankAccountId, bankAccountId))!]
        : []),
    ));
}

export async function markLineMatched(tx: Writer, lineId: string, matchType: string, matchId: string): Promise<void> {
  await tx.update(bankStatementLines)
    .set({ matched: true, matchType, matchId, matchedAt: new Date() })
    .where(eq(bankStatementLines.id, lineId));
}

/** Executor that can run raw SQL (drizzle db or tx). */
type Exec = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

/**
 * H1: reconcile a payment exactly once. Guarded on reconciled=false so two
 * concurrent /reconcile calls cannot both match the same payment to two
 * different statement lines. Returns true if this caller won the match.
 */
export async function markPaymentReconciled(tx: Exec, id: string, lineId: string): Promise<boolean> {
  const rows = await tx.execute(sql`
    UPDATE payments.finance_payments
       SET reconciled = true, reconciled_line_id = ${lineId}, reconciled_at = now()
     WHERE id = ${id} AND reconciled = false
    RETURNING id
  `);
  return (rows as unknown as unknown[]).length > 0;
}

/** H1: reconcile a challan exactly once (guarded on reconciled=false). */
export async function markChallanReconciled(tx: Exec, id: string, lineId: string): Promise<boolean> {
  const rows = await tx.execute(sql`
    UPDATE treasury.finance_challans
       SET reconciled = true, reconciled_line_id = ${lineId}, reconciled_at = now()
     WHERE id = ${id} AND reconciled = false
    RETURNING id
  `);
  return (rows as unknown as unknown[]).length > 0;
}

/** All lines for a statement (no tx). */
export async function allLines(statementId: string): Promise<BankStatementLineRow[]> {
  return db.select().from(bankStatementLines).where(eq(bankStatementLines.statementId, statementId));
}
