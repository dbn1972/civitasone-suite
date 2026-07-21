import { and, eq, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { legalCounselBriefs, type CounselBriefRow, type CounselBriefInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findBriefById(id: string): Promise<CounselBriefRow | null> {
  const rows = await db.transaction(async (tx) =>
    tx.select().from(legalCounselBriefs).where(eq(legalCounselBriefs.id, id)).limit(1));
  return rows[0] ?? null;
}

export async function insertBrief(tx: Writer, row: CounselBriefInsert): Promise<void> {
  await tx.insert(legalCounselBriefs).values(row);
}

export async function listBriefs(tenantId: string, caseId?: string, status?: string, limit = 100): Promise<CounselBriefRow[]> {
  const conditions = [eq(legalCounselBriefs.tenantId, tenantId)];
  if (caseId) conditions.push(eq(legalCounselBriefs.caseId, caseId));
  if (status) conditions.push(eq(legalCounselBriefs.status, status));
  return db.transaction(async (tx) =>
    tx.select().from(legalCounselBriefs).where(and(...conditions)).orderBy(desc(legalCounselBriefs.assignedAt)).limit(limit));
}
