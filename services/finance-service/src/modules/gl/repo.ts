import { eq, and, gte, lte, sql, asc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { financeJournals, financeLedger, type JournalRow, type JournalInsert, type LedgerInsert } from "./schema.js";
import { financeHeads } from "../budget/schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertJournal(tx: Writer, row: JournalInsert): Promise<void> {
  await tx.insert(financeJournals).values(row);
}

export async function insertLedgerLine(tx: Writer, row: LedgerInsert): Promise<void> {
  await tx.insert(financeLedger).values(row);
}

export async function findJournalById(id: string): Promise<JournalRow | null> {
  const rows = await db.select().from(financeJournals).where(eq(financeJournals.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Resolve a headId that may be a UUID or a 4-digit account code. Returns the UUID or null. */
export async function resolveHeadId(tenantId: string, headIdOrCode: string): Promise<string | null> {
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(headIdOrCode);
  if (isUUID) return headIdOrCode;
  const rows = await db.select({ id: financeHeads.id })
    .from(financeHeads)
    .where(and(eq(financeHeads.tenantId, tenantId), eq(financeHeads.code, headIdOrCode)))
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function getLedgerLines(tenantId: string, headId: string | undefined, from?: string, to?: string, limit = 50) {
  const conditions: ReturnType<typeof eq>[] = [eq(financeLedger.tenantId, tenantId)];
  if (headId) conditions.push(eq(financeLedger.headId, headId));
  if (from) conditions.push(gte(financeLedger.postingDate, from));
  if (to)   conditions.push(lte(financeLedger.postingDate, to));
  return db.select().from(financeLedger).where(and(...conditions)).orderBy(asc(financeLedger.postingDate)).limit(limit);
}

export async function getTrialBalance(tenantId: string) {
  return db
    .select({
      headId:      financeLedger.headId,
      totalDebit:  sql<bigint>`sum(${financeLedger.debitMinor})`.mapWith(BigInt),
      totalCredit: sql<bigint>`sum(${financeLedger.creditMinor})`.mapWith(BigInt),
    })
    .from(financeLedger)
    .where(eq(financeLedger.tenantId, tenantId))
    .groupBy(financeLedger.headId);
}

export async function listJournalsByTenant(tenantId: string, limit: number): Promise<JournalRow[]> {
  return db.select().from(financeJournals)
    .where(eq(financeJournals.tenantId, tenantId))
    .limit(limit);
}
