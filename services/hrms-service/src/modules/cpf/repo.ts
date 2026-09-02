import { eq, and, desc, asc, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import {
  hrmsCpfAccounts, hrmsCpfLedger,
  type CpfAccountRow, type CpfAccountInsert, type CpfLedgerRow, type CpfLedgerInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
export type LockingTx = Writer & Pick<typeof db, "execute">;

export interface Balances { emp: bigint; er: bigint; total: bigint }

export async function findAccountByEmployee(tenantId: string, employeeId: string): Promise<CpfAccountRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsCpfAccounts)
    .where(and(eq(hrmsCpfAccounts.tenantId, tenantId), eq(hrmsCpfAccounts.employeeId, employeeId))).limit(1));
  return rows[0] ?? null;
}

/**
 * Synchronous pre-check for the (tenant, cpf_number) uniqueness the DB enforces
 * via `hrms_cpf_accounts_cpf_number_uq`. Read-before-publish only — a route
 * calling this still has a residual TOCTOU race against a concurrent open with
 * the same number; the DB constraint is the real backstop for that rare case.
 */
export async function findAccountByCpfNumber(tenantId: string, cpfNumber: string): Promise<CpfAccountRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsCpfAccounts)
    .where(and(eq(hrmsCpfAccounts.tenantId, tenantId), eq(hrmsCpfAccounts.cpfNumber, cpfNumber))).limit(1));
  return rows[0] ?? null;
}

/**
 * Synchronous pre-check for the (tenant, account, period) subscription
 * uniqueness the DB enforces via the partial unique index
 * `hrms_cpf_ledger_period_uq` (entry_type = 'subscription'). Same residual
 * TOCTOU caveat as findAccountByCpfNumber above.
 */
export async function findSubscriptionForPeriod(tenantId: string, accountId: string, period: string): Promise<CpfLedgerRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsCpfLedger)
    .where(and(
      eq(hrmsCpfLedger.tenantId, tenantId), eq(hrmsCpfLedger.accountId, accountId),
      eq(hrmsCpfLedger.period, period), eq(hrmsCpfLedger.entryType, "subscription"),
    )).limit(1));
  return rows[0] ?? null;
}

export async function insertAccount(tx: Writer, row: CpfAccountInsert): Promise<void> {
  await tx.insert(hrmsCpfAccounts).values(row);
}

export async function insertLedger(tx: Writer, row: CpfLedgerInsert): Promise<void> {
  await tx.insert(hrmsCpfLedger).values(row);
}

export async function bumpAccountVersion(
  tx: Writer, tenantId: string, accountId: string, updatedBy: string, expectedVersion?: number,
): Promise<void> {
  const where = expectedVersion !== undefined
    ? and(eq(hrmsCpfAccounts.tenantId, tenantId), eq(hrmsCpfAccounts.id, accountId), eq(hrmsCpfAccounts.version, expectedVersion))
    : and(eq(hrmsCpfAccounts.tenantId, tenantId), eq(hrmsCpfAccounts.id, accountId));
  const res = await tx.update(hrmsCpfAccounts)
    .set({ version: sql`${hrmsCpfAccounts.version} + 1`, updatedBy, updatedAt: new Date() })
    .where(where);
  if (expectedVersion !== undefined && ((res as { rowCount?: number; count?: number }).rowCount ?? (res as { count?: number }).count ?? 0) === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", "CPF account was modified by another request; reload and retry");
  }
}

export async function currentBalance(tenantId: string, account: CpfAccountRow): Promise<Balances> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsCpfLedger)
    .where(and(eq(hrmsCpfLedger.tenantId, tenantId), eq(hrmsCpfLedger.accountId, account.id)))
    .orderBy(desc(hrmsCpfLedger.createdAt), desc(hrmsCpfLedger.id)).limit(1));
  const r = rows[0];
  if (!r) return { emp: account.openingEmpMinor, er: account.openingErMinor, total: account.openingEmpMinor + account.openingErMinor };
  return { emp: r.empBalanceMinor, er: r.erBalanceMinor, total: r.balanceMinor };
}

export async function lockedBalance(tx: LockingTx, tenantId: string, account: CpfAccountRow): Promise<Balances> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}::text || ':' || ${account.id}::text, 0))`);
  const rows = await tx.select().from(hrmsCpfLedger)
    .where(and(eq(hrmsCpfLedger.tenantId, tenantId), eq(hrmsCpfLedger.accountId, account.id)))
    .orderBy(desc(hrmsCpfLedger.createdAt), desc(hrmsCpfLedger.id)).limit(1);
  const r = rows[0];
  if (!r) return { emp: account.openingEmpMinor, er: account.openingErMinor, total: account.openingEmpMinor + account.openingErMinor };
  return { emp: r.empBalanceMinor, er: r.erBalanceMinor, total: r.balanceMinor };
}

export async function listLedger(tenantId: string, accountId: string, limit = 500): Promise<CpfLedgerRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsCpfLedger)
    .where(and(eq(hrmsCpfLedger.tenantId, tenantId), eq(hrmsCpfLedger.accountId, accountId)))
    .orderBy(asc(hrmsCpfLedger.createdAt))
    .limit(limit));
}
