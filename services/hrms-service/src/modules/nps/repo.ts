import { eq, and, desc, asc, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import {
  hrmsNpsAccounts, hrmsNpsContributions,
  type NpsAccountRow, type NpsAccountInsert, type NpsContribRow, type NpsContribInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
export type LockingTx = Writer & Pick<typeof db, "execute">;

/** Balance triple carried on every contribution row (employee leg + employer leg + total). */
export interface Balances { emp: bigint; er: bigint; total: bigint }

export async function findAccountByEmployee(tenantId: string, employeeId: string): Promise<NpsAccountRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsNpsAccounts)
    .where(and(eq(hrmsNpsAccounts.tenantId, tenantId), eq(hrmsNpsAccounts.employeeId, employeeId))).limit(1));
  return rows[0] ?? null;
}

export async function insertAccount(tx: Writer, row: NpsAccountInsert): Promise<void> {
  await tx.insert(hrmsNpsAccounts).values(row);
}

export async function insertContribution(tx: Writer, row: NpsContribInsert): Promise<void> {
  await tx.insert(hrmsNpsContributions).values(row);
}

/**
 * Optimistic-lock bump on every ledger mutation. When expectedVersion is given
 * the bump is guarded so a stale concurrent op cannot clobber the account row.
 */
export async function bumpAccountVersion(
  tx: Writer, tenantId: string, accountId: string, updatedBy: string, expectedVersion?: number,
): Promise<void> {
  const where = expectedVersion !== undefined
    ? and(eq(hrmsNpsAccounts.tenantId, tenantId), eq(hrmsNpsAccounts.id, accountId), eq(hrmsNpsAccounts.version, expectedVersion))
    : and(eq(hrmsNpsAccounts.tenantId, tenantId), eq(hrmsNpsAccounts.id, accountId));
  const res = await tx.update(hrmsNpsAccounts)
    .set({ version: sql`${hrmsNpsAccounts.version} + 1`, updatedBy, updatedAt: new Date() })
    .where(where);
  if (expectedVersion !== undefined && (res as { rowCount?: number }).rowCount === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", "NPS account was modified by another request; reload and retry");
  }
}

/** Latest running balance triple, else opening balances from the account row. */
export async function currentBalance(tenantId: string, account: NpsAccountRow): Promise<Balances> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsNpsContributions)
    .where(and(eq(hrmsNpsContributions.tenantId, tenantId), eq(hrmsNpsContributions.accountId, account.id)))
    .orderBy(desc(hrmsNpsContributions.createdAt), desc(hrmsNpsContributions.id)).limit(1));
  const r = rows[0];
  if (!r) return { emp: account.openingEmpMinor, er: account.openingErMinor, total: account.openingEmpMinor + account.openingErMinor };
  return { emp: r.empBalanceMinor, er: r.erBalanceMinor, total: r.balanceMinor };
}

/**
 * Serialise concurrent postings against one NPS account via a tx-scoped advisory
 * lock keyed on (tenant, account), THEN read the running balance inside the same
 * transaction so two concurrent debits cannot both pass the balance guard. (C1)
 */
export async function lockedBalance(tx: LockingTx, tenantId: string, account: NpsAccountRow): Promise<Balances> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}::text || ':' || ${account.id}::text, 0))`);
  const rows = await tx.select().from(hrmsNpsContributions)
    .where(and(eq(hrmsNpsContributions.tenantId, tenantId), eq(hrmsNpsContributions.accountId, account.id)))
    .orderBy(desc(hrmsNpsContributions.createdAt), desc(hrmsNpsContributions.id)).limit(1);
  const r = rows[0];
  if (!r) return { emp: account.openingEmpMinor, er: account.openingErMinor, total: account.openingEmpMinor + account.openingErMinor };
  return { emp: r.empBalanceMinor, er: r.erBalanceMinor, total: r.balanceMinor };
}

export async function listContributions(tenantId: string, accountId: string, limit = 500): Promise<NpsContribRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsNpsContributions)
    .where(and(eq(hrmsNpsContributions.tenantId, tenantId), eq(hrmsNpsContributions.accountId, accountId)))
    .orderBy(asc(hrmsNpsContributions.createdAt))
    .limit(limit));
}
