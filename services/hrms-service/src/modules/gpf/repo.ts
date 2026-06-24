import { eq, and, desc, asc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  hrmsGpfAccounts, hrmsGpfLedger,
  type GpfAccountRow, type GpfAccountInsert, type GpfLedgerRow, type GpfLedgerInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/** A transaction handle that can post ledger rows AND take advisory locks / read the locked balance. */
export type LockingTx = Writer & Pick<typeof db, "execute">;

export async function findAccountByEmployee(tenantId: string, employeeId: string): Promise<GpfAccountRow | null> {
  const rows = await db.select().from(hrmsGpfAccounts)
    .where(and(eq(hrmsGpfAccounts.tenantId, tenantId), eq(hrmsGpfAccounts.employeeId, employeeId))).limit(1);
  return rows[0] ?? null;
}

export async function findAccountById(tenantId: string, id: string): Promise<GpfAccountRow | null> {
  const rows = await db.select().from(hrmsGpfAccounts)
    .where(and(eq(hrmsGpfAccounts.tenantId, tenantId), eq(hrmsGpfAccounts.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function insertAccount(tx: Writer, row: GpfAccountInsert): Promise<void> {
  await tx.insert(hrmsGpfAccounts).values(row);
}

export async function insertLedger(tx: Writer, row: GpfLedgerInsert): Promise<void> {
  await tx.insert(hrmsGpfLedger).values(row);
}

/** Current running balance = latest ledger balance, else opening balance. */
export async function currentBalance(tenantId: string, account: GpfAccountRow): Promise<bigint> {
  const rows = await db.select().from(hrmsGpfLedger)
    .where(and(eq(hrmsGpfLedger.tenantId, tenantId), eq(hrmsGpfLedger.accountId, account.id)))
    .orderBy(desc(hrmsGpfLedger.createdAt)).limit(1);
  return rows[0]?.balanceMinor ?? account.openingBalanceMinor;
}

/**
 * Serialise concurrent postings against one GPF account by taking a
 * transaction-scoped advisory lock keyed on the account id, THEN reading the
 * running balance inside the SAME transaction. Two concurrent advances against
 * the same account are forced to run one-after-another: the second blocks on
 * the lock until the first commits, so it sees the updated balance and its
 * INSUFFICIENT_BALANCE guard fires. (C1)
 */
export async function lockedBalance(tx: LockingTx, tenantId: string, account: GpfAccountRow): Promise<bigint> {
  // Transaction-scoped advisory lock keyed on (tenant, account) so it is unique
  // per account and auto-released at commit/rollback. Use the single-bigint form
  // (pg_advisory_xact_lock(bigint)) with a 64-bit hash of the composite key.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}::text || ':' || ${account.id}::text, 0))`);
  const rows = await tx.select().from(hrmsGpfLedger)
    .where(and(eq(hrmsGpfLedger.tenantId, tenantId), eq(hrmsGpfLedger.accountId, account.id)))
    .orderBy(desc(hrmsGpfLedger.createdAt), desc(hrmsGpfLedger.id)).limit(1);
  return rows[0]?.balanceMinor ?? account.openingBalanceMinor;
}

export async function listLedger(tenantId: string, accountId: string): Promise<GpfLedgerRow[]> {
  return db.select().from(hrmsGpfLedger)
    .where(and(eq(hrmsGpfLedger.tenantId, tenantId), eq(hrmsGpfLedger.accountId, accountId)))
    .orderBy(asc(hrmsGpfLedger.createdAt));
}
