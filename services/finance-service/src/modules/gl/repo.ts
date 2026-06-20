import { eq, and, gte, lte, sql, asc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { financeJournals, financeLedger, type JournalRow, type JournalInsert, type LedgerInsert } from "./schema.js";

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

export async function getLedgerLines(tenantId: string, headId: string, from?: string, to?: string, limit = 50) {
  const conditions = [eq(financeLedger.tenantId, tenantId), eq(financeLedger.headId, headId)];
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
