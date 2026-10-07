import { and, eq, desc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { legalOpinions, type OpinionRow, type OpinionInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * GAP-LEGAL-OPINIONS-NEW-02: allocate the next opinion number in the
 * OPN/<year>/NNNN series for a tenant, inside the caller's transaction. The
 * sequence base is the count of this tenant's opinions whose number already
 * matches the current year's prefix; the UNIQUE (tenant_id, opinion_no)
 * constraint is the real guarantee of distinctness — if two commands race and
 * compute the same N, the second INSERT fails and the queue redelivers it,
 * which recomputes against the now-higher count. This replaces a client-side
 * `Math.random()` number that could collide and did not follow the series.
 */
export async function nextOpinionNo(tx: Writer, tenantId: string, year: number): Promise<string> {
  const prefix = `OPN/${year}/`;
  const rows = await (tx as typeof db)
    .select({ count: sql<number>`count(*)::int` })
    .from(legalOpinions)
    .where(and(eq(legalOpinions.tenantId, tenantId), sql`${legalOpinions.opinionNo} LIKE ${prefix + "%"}`));
  const seq = (rows[0]?.count ?? 0) + 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export async function findOpinionById(id: string): Promise<OpinionRow | null> {
  const rows = await db.transaction(async (tx) =>
    tx.select().from(legalOpinions).where(eq(legalOpinions.id, id)).limit(1));
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
  return db.transaction(async (tx) =>
    tx.select().from(legalOpinions).where(and(...conditions)).orderBy(desc(legalOpinions.soughtAt)).limit(limit));
}
