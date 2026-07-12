import { eq, and, gte, lte, sql, asc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { financeJournals, financeLedger, financeJournalLines, type JournalRow, type JournalInsert, type LedgerInsert, type JournalLineInsert } from "./schema.js";
import { financeHeads } from "../budget/schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertJournal(tx: Writer, row: JournalInsert): Promise<void> {
  await tx.insert(financeJournals).values(row);
}

export async function insertLedgerLine(tx: Writer, row: LedgerInsert): Promise<void> {
  await tx.insert(financeLedger).values(row);
}

export async function insertJournalLine(tx: Writer, row: JournalLineInsert): Promise<void> {
  await tx.insert(financeJournalLines).values(row);
}

export async function findJournalById(id: string): Promise<JournalRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(financeJournals).where(eq(financeJournals.id, id)).limit(1));
  return rows[0] ?? null;
}

/** Idempotency check inside a tx: has this journal id already been posted? */
export async function findJournalByIdTx(tx: Writer, id: string): Promise<JournalRow | null> {
  const rows = await (tx as typeof db).select().from(financeJournals).where(eq(financeJournals.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Mark a journal reversed and link the reversing journal (controlled status transition). */
export async function markJournalReversed(tx: Writer, id: string, reversedByUpdatedBy: string): Promise<void> {
  await tx.update(financeJournals)
    .set({ status: "reversed", updatedBy: reversedByUpdatedBy, updatedAt: new Date() })
    .where(eq(financeJournals.id, id));
}

/** Resolve a headId that may be a UUID or a 4-digit account code. Returns the UUID or null. */
export async function resolveHeadId(tenantId: string, headIdOrCode: string): Promise<string | null> {
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(headIdOrCode);
  if (isUUID) return headIdOrCode;
  const rows = await scopedRead((tx) => tx.select({ id: financeHeads.id })
    .from(financeHeads)
    .where(and(eq(financeHeads.tenantId, tenantId), eq(financeHeads.code, headIdOrCode)))
    .limit(1));
  return rows[0]?.id ?? null;
}

export async function getLedgerLines(tenantId: string, headId: string | undefined, from?: string, to?: string, limit = 50) {
  const conditions: ReturnType<typeof eq>[] = [eq(financeLedger.tenantId, tenantId)];
  if (headId) conditions.push(eq(financeLedger.headId, headId));
  if (from) conditions.push(gte(financeLedger.postingDate, from));
  if (to)   conditions.push(lte(financeLedger.postingDate, to));
  return scopedRead((tx) => tx.select().from(financeLedger).where(and(...conditions)).orderBy(asc(financeLedger.postingDate)).limit(limit));
}

export async function getTrialBalance(tenantId: string) {
  return scopedRead((tx) => tx
    .select({
      headId:      financeLedger.headId,
      totalDebit:  sql<bigint>`sum(${financeLedger.debitMinor})`.mapWith(BigInt),
      totalCredit: sql<bigint>`sum(${financeLedger.creditMinor})`.mapWith(BigInt),
    })
    .from(financeLedger)
    .where(eq(financeLedger.tenantId, tenantId))
    .groupBy(financeLedger.headId));
}

export async function listJournalsByTenant(tenantId: string, limit: number): Promise<JournalRow[]> {
  return scopedRead((tx) => tx.select().from(financeJournals)
    .where(eq(financeJournals.tenantId, tenantId))
    .limit(limit));
}

/**
 * Trial balance summed per period (YYYY-MM from posting_date), with the
 * balanced check: sum(debit) must equal sum(credit) for every period.
 */
export async function getTrialBalanceByPeriod(tenantId: string, period?: string) {
  const conditions = [eq(financeLedger.tenantId, tenantId)];
  if (period) conditions.push(sql`to_char(${financeLedger.postingDate}, 'YYYY-MM') = ${period}`);
  return scopedRead((tx) => tx
    .select({
      period:      sql<string>`to_char(${financeLedger.postingDate}, 'YYYY-MM')`,
      totalDebit:  sql<bigint>`sum(${financeLedger.debitMinor})`.mapWith(BigInt),
      totalCredit: sql<bigint>`sum(${financeLedger.creditMinor})`.mapWith(BigInt),
    })
    .from(financeLedger)
    .where(and(...conditions))
    .groupBy(sql`to_char(${financeLedger.postingDate}, 'YYYY-MM')`)
    .orderBy(sql`to_char(${financeLedger.postingDate}, 'YYYY-MM')`));
}
