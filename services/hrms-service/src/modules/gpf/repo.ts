import { eq, and, desc, asc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  hrmsGpfAccounts, hrmsGpfLedger,
  type GpfAccountRow, type GpfAccountInsert, type GpfLedgerRow, type GpfLedgerInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

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

export async function listLedger(tenantId: string, accountId: string): Promise<GpfLedgerRow[]> {
  return db.select().from(hrmsGpfLedger)
    .where(and(eq(hrmsGpfLedger.tenantId, tenantId), eq(hrmsGpfLedger.accountId, accountId)))
    .orderBy(asc(hrmsGpfLedger.createdAt));
}
