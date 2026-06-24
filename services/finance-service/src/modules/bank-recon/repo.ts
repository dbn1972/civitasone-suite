import { eq, and, sql } from "drizzle-orm";
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

/** Unreconciled payments (money out) for a tenant — match against debit statement lines. */
export async function unreconciledPayments(tenantId: string) {
  return db.select({
    id: financePayments.id,
    amountMinor: financePayments.amountMinor,
    date: sql<string>`to_char(${financePayments.createdAt}, 'YYYY-MM-DD')`,
    reference: financePayments.utr,
  }).from(financePayments)
    .where(and(eq(financePayments.tenantId, tenantId), eq(financePayments.reconciled, false)));
}

/** Unreconciled challans/receipts (money in) — match against credit statement lines. */
export async function unreconciledChallans(tenantId: string) {
  return db.select({
    id: financeChallans.id,
    amountMinor: financeChallans.amountMinor,
    date: sql<string>`to_char(${financeChallans.createdAt}, 'YYYY-MM-DD')`,
    reference: financeChallans.challanNo,
  }).from(financeChallans)
    .where(and(eq(financeChallans.tenantId, tenantId), eq(financeChallans.reconciled, false)));
}

export async function markLineMatched(tx: Writer, lineId: string, matchType: string, matchId: string): Promise<void> {
  await tx.update(bankStatementLines)
    .set({ matched: true, matchType, matchId, matchedAt: new Date() })
    .where(eq(bankStatementLines.id, lineId));
}

export async function markPaymentReconciled(tx: Writer, id: string, lineId: string): Promise<void> {
  await tx.update(financePayments)
    .set({ reconciled: true, reconciledLineId: lineId, reconciledAt: new Date() })
    .where(eq(financePayments.id, id));
}

export async function markChallanReconciled(tx: Writer, id: string, lineId: string): Promise<void> {
  await tx.update(financeChallans)
    .set({ reconciled: true, reconciledLineId: lineId, reconciledAt: new Date() })
    .where(eq(financeChallans.id, id));
}

/** All lines for a statement (no tx). */
export async function allLines(statementId: string): Promise<BankStatementLineRow[]> {
  return db.select().from(bankStatementLines).where(eq(bankStatementLines.statementId, statementId));
}
