import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { legalCases, legalParties, type CaseRow, type CaseInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findCaseById(id: string): Promise<CaseRow | null> {
  const rows = await db.transaction(async (tx) =>
    tx.select().from(legalCases).where(eq(legalCases.id, id)).limit(1));
  return rows[0] ?? null;
}

export async function findCaseByIdTx(tx: Writer, id: string): Promise<CaseRow | null> {
  const rows = await (tx as typeof db).select().from(legalCases).where(eq(legalCases.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertCase(tx: Writer, row: CaseInsert): Promise<void> {
  await tx.insert(legalCases).values(row);
}

export async function updateCase(tx: Writer, id: string, patch: Partial<CaseInsert>): Promise<void> {
  await tx.update(legalCases).set({ ...patch, updatedAt: new Date() }).where(eq(legalCases.id, id));
}

export async function listCases(tenantId: string, status?: string, caseTypeId?: string, limit = 100): Promise<CaseRow[]> {
  const conditions = [eq(legalCases.tenantId, tenantId)];
  if (status) conditions.push(eq(legalCases.status, status));
  if (caseTypeId) conditions.push(eq(legalCases.caseTypeId, caseTypeId));
  return db.transaction(async (tx) =>
    tx.select().from(legalCases).where(and(...conditions)).limit(limit));
}

export async function insertParty(tx: Writer, row: typeof legalParties.$inferInsert): Promise<void> {
  await tx.insert(legalParties).values(row);
}
