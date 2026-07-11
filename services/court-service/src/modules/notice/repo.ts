import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { notices, noticeService } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
export type NoticeRow    = typeof notices.$inferSelect;
export type NoticeInsert = typeof notices.$inferInsert;
export type NoticeServiceRow    = typeof noticeService.$inferSelect;
export type NoticeServiceInsert = typeof noticeService.$inferInsert;

export async function insertNotice(tx: Writer, row: NoticeInsert): Promise<void> {
  // Idempotent on the deterministic id: a redelivery with the same id is a no-op.
  await tx.insert(notices).values(row).onConflictDoNothing({ target: notices.id });
}

export async function getNoticeForUpdate(
  tx: Writer, tenantId: string, id: string,
): Promise<{ status: string; version: number } | undefined> {
  const rows = await tx.select({ status: notices.status, version: notices.version })
    .from(notices)
    .where(and(eq(notices.tenantId, tenantId), eq(notices.id, id)))
    .limit(1);
  return rows[0];
}

export async function insertService(tx: Writer, row: NoticeServiceInsert): Promise<void> {
  // Idempotent on the deterministic id: a redelivery with the same id is a no-op.
  await tx.insert(noticeService).values(row).onConflictDoNothing({ target: noticeService.id });
}

export async function listServiceByNotice(tenantId: string, noticeId: string): Promise<NoticeServiceRow[]> {
  return db.select().from(noticeService)
    .where(and(eq(noticeService.tenantId, tenantId), eq(noticeService.noticeId, noticeId)))
    .orderBy(desc(noticeService.createdAt));
}

export async function listNoticesByCase(tenantId: string, caseId: string): Promise<NoticeRow[]> {
  return db.select().from(notices)
    .where(and(eq(notices.tenantId, tenantId), eq(notices.caseId, caseId)))
    .orderBy(desc(notices.issueDate));
}
