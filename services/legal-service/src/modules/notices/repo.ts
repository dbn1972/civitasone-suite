import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { legalNotices, legalNoticeResponses, type NoticeRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findNoticeByIdTx(tx: Writer, id: string): Promise<NoticeRow | null> {
  const rows = await (tx as typeof db).select().from(legalNotices).where(eq(legalNotices.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertNotice(tx: Writer, row: typeof legalNotices.$inferInsert): Promise<void> {
  await tx.insert(legalNotices).values(row);
}

export async function updateNotice(tx: Writer, id: string, patch: Partial<typeof legalNotices.$inferInsert>): Promise<void> {
  await tx.update(legalNotices).set({ ...patch, updatedAt: new Date() }).where(eq(legalNotices.id, id));
}

export async function insertNoticeResponse(tx: Writer, row: typeof legalNoticeResponses.$inferInsert): Promise<void> {
  await tx.insert(legalNoticeResponses).values(row);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<NoticeRow[]> {
  const rows = await db.select().from(legalNotices)
    .where(eq(legalNotices.tenantId, tenantId))
    .orderBy(legalNotices.createdAt)
    .limit(limit)
    .offset(offset);
  return rows;
}

export async function getById(tenantId: string, id: string): Promise<NoticeRow | null> {
  const rows = await db.select().from(legalNotices)
    .where(and(eq(legalNotices.tenantId, tenantId), eq(legalNotices.id, id)))
    .limit(1);
  return rows[0] ?? null;
}
