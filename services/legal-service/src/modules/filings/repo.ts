import { and, eq, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { legalFilings, type FilingRow, type FilingInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findFilingById(id: string): Promise<FilingRow | null> {
  const rows = await db.transaction(async (tx) =>
    tx.select().from(legalFilings).where(eq(legalFilings.id, id)).limit(1));
  return rows[0] ?? null;
}

export async function insertFiling(tx: Writer, row: FilingInsert): Promise<void> {
  await tx.insert(legalFilings).values(row);
}

export async function listFilings(tenantId: string, caseId?: string, filingType?: string, status?: string, limit = 100): Promise<FilingRow[]> {
  const conditions = [eq(legalFilings.tenantId, tenantId)];
  if (caseId) conditions.push(eq(legalFilings.caseId, caseId));
  if (filingType) conditions.push(eq(legalFilings.filingType, filingType));
  if (status) conditions.push(eq(legalFilings.status, status));
  return db.transaction(async (tx) =>
    tx.select().from(legalFilings).where(and(...conditions)).orderBy(desc(legalFilings.filingDate)).limit(limit));
}
