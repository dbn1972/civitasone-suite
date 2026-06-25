import { and, eq, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { legalOpinions, type OpinionRow, type OpinionInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findOpinionById(id: string): Promise<OpinionRow | null> {
  const rows = await db.select().from(legalOpinions).where(eq(legalOpinions.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findOpinionByIdTx(tx: Writer, id: string): Promise<OpinionRow | null> {
  const rows = await (tx as typeof db).select().from(legalOpinions).where(eq(legalOpinions.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertOpinion(tx: Writer, row: OpinionInsert): Promise<void> {
  await tx.insert(legalOpinions).values(row);
}

export async function updateOpinion(tx: Writer, id: string, patch: Partial<OpinionInsert>): Promise<void> {
  await tx.update(legalOpinions).set({ ...patch, updatedAt: new Date() }).where(eq(legalOpinions.id, id));
}

export async function listOpinions(tenantId: string, status?: string, caseId?: string, limit = 100): Promise<OpinionRow[]> {
  const conditions = [eq(legalOpinions.tenantId, tenantId)];
  if (status) conditions.push(eq(legalOpinions.status, status));
  if (caseId) conditions.push(eq(legalOpinions.caseId, caseId));
  return db.select().from(legalOpinions).where(and(...conditions)).orderBy(desc(legalOpinions.soughtAt)).limit(limit);
}
