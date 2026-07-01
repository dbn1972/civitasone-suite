import { eq, and, asc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabReference } from "./schema.js";
import type { ReferenceRow, ReferenceInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select" | "delete">;

export async function insertReference(tx: Writer, row: ReferenceInsert): Promise<void> {
  await tx.insert(estabReference).values(row);
}

export async function deleteReference(tx: Writer, id: string, tenantId: string): Promise<void> {
  await (tx as typeof db).delete(estabReference)
    .where(and(eq(estabReference.id, id), eq(estabReference.tenantId, tenantId)));
}

export async function listReferencesByFile(tenantId: string, fileId: string): Promise<ReferenceRow[]> {
  return db.select().from(estabReference)
    .where(and(eq(estabReference.tenantId, tenantId), eq(estabReference.fileId, fileId)))
    .orderBy(asc(estabReference.createdAt));
}

export async function listReferencesByNote(tenantId: string, noteId: string): Promise<ReferenceRow[]> {
  return db.select().from(estabReference)
    .where(and(eq(estabReference.tenantId, tenantId), eq(estabReference.noteId, noteId)))
    .orderBy(asc(estabReference.createdAt));
}

export async function findReferenceById(id: string, tenantId: string): Promise<ReferenceRow | null> {
  const rows = await db.select().from(estabReference)
    .where(and(eq(estabReference.id, id), eq(estabReference.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}
