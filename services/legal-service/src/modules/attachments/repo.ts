import { and, desc, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { legalCaseAttachments, type AttachmentRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function listByCase(tenantId: string, caseId: string): Promise<AttachmentRow[]> {
  return db.transaction((tx) => tx.select().from(legalCaseAttachments)
    .where(and(eq(legalCaseAttachments.tenantId, tenantId), eq(legalCaseAttachments.caseId, caseId)))
    .orderBy(desc(legalCaseAttachments.createdAt)).limit(200));
}

export async function findOne(tenantId: string, caseId: string, id: string): Promise<AttachmentRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(legalCaseAttachments)
    .where(and(eq(legalCaseAttachments.tenantId, tenantId), eq(legalCaseAttachments.caseId, caseId), eq(legalCaseAttachments.id, id)))
    .limit(1));
  return rows[0] ?? null;
}

export async function insert(tx: Writer, row: typeof legalCaseAttachments.$inferInsert): Promise<void> {
  await tx.insert(legalCaseAttachments).values(row);
}

/** Guarded status write: only moves a row that is not already in `to`, and never out of a terminal state. */
export async function setStatus(
  tx: Writer, tenantId: string, id: string,
  to: string, actor: string, documentId?: string | null,
): Promise<boolean> {
  const rows = await (tx as typeof db).update(legalCaseAttachments)
    .set({ status: to, ...(documentId ? { documentId } : {}), updatedBy: actor, updatedAt: new Date() })
    .where(and(eq(legalCaseAttachments.id, id), eq(legalCaseAttachments.tenantId, tenantId)))
    .returning({ id: legalCaseAttachments.id, status: legalCaseAttachments.status });
  return rows.length > 0;
}

export async function findOneTx(tx: Writer, tenantId: string, id: string): Promise<AttachmentRow | null> {
  const rows = await (tx as typeof db).select().from(legalCaseAttachments)
    .where(and(eq(legalCaseAttachments.tenantId, tenantId), eq(legalCaseAttachments.id, id))).limit(1);
  return rows[0] ?? null;
}
