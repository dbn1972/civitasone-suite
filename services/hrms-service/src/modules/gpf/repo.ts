import { eq, and, desc, asc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
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

/**
 * Increment the account's optimistic-lock `version` on every ledger mutation
 * (L4). When `expectedVersion` is supplied the bump is GUARDED: it only applies
 * while the stored version still matches, otherwise a 409 VERSION_CONFLICT is
 * raised so a stale concurrent op cannot clobber the account row. Postings are
 * already serialised per-account via the advisory lock in `lockedBalance`, so
 * within a posting tx the guard always observes the freshest version.
 */
export async function bumpAccountVersion(
  tx: Writer, tenantId: string, accountId: string, updatedBy: string, expectedVersion?: number,
): Promise<void> {
  const where = expectedVersion !== undefined
    ? and(eq(hrmsGpfAccounts.tenantId, tenantId), eq(hrmsGpfAccounts.id, accountId), eq(hrmsGpfAccounts.version, expectedVersion))
    : and(eq(hrmsGpfAccounts.tenantId, tenantId), eq(hrmsGpfAccounts.id, accountId));
  const res = await tx.update(hrmsGpfAccounts)
    .set({ version: sql`${hrmsGpfAccounts.version} + 1`, updatedBy, updatedAt: new Date() })
    .where(where);
  if (expectedVersion !== undefined && (res as { rowCount?: number }).rowCount === 0) {
    throw new HttpError(409, "VERSION_CONFLICT",
      "GPF account was modified by another request; reload and retry");
  }
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
