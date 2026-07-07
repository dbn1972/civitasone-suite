import { and, eq, desc, isNull } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  matterDocuments,
  documentVersions,
  type MatterDocumentRow,
  type MatterDocumentInsert,
  type DocumentVersionRow,
  type DocumentVersionInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select" | "delete">;

export async function findDocumentById(id: string): Promise<MatterDocumentRow | null> {
  const rows = await db.select().from(matterDocuments).where(eq(matterDocuments.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findDocumentByIdTx(tx: Writer, id: string): Promise<MatterDocumentRow | null> {
  const rows = await (tx as typeof db).select().from(matterDocuments).where(eq(matterDocuments.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertDocument(tx: Writer, row: MatterDocumentInsert): Promise<void> {
  await tx.insert(matterDocuments).values(row);
}

export async function updateDocument(tx: Writer, id: string, patch: Partial<MatterDocumentInsert>): Promise<void> {
  await tx.update(matterDocuments).set({ ...patch, updatedAt: new Date() }).where(eq(matterDocuments.id, id));
}

export async function deleteDocument(tx: Writer, id: string): Promise<void> {
  await (tx as typeof db).delete(matterDocuments).where(eq(matterDocuments.id, id));
}

export async function listDocuments(
  tenantId: string,
  matterId: string,
  parentFolderId?: string,
): Promise<MatterDocumentRow[]> {
  const conditions = [
    eq(matterDocuments.tenantId, tenantId),
    eq(matterDocuments.matterId, matterId),
  ];
  if (parentFolderId) {
    conditions.push(eq(matterDocuments.parentFolderId, parentFolderId));
  } else {
    conditions.push(isNull(matterDocuments.parentFolderId));
  }
  return db.select().from(matterDocuments).where(and(...conditions));
}

export async function insertVersion(tx: Writer, row: DocumentVersionInsert): Promise<void> {
  await tx.insert(documentVersions).values(row);
}

export async function listVersions(documentId: string, limit: number): Promise<DocumentVersionRow[]> {
  return db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.versionNumber))
    .limit(limit);
}

export async function setLegalHold(tx: Writer, id: string, hold: boolean): Promise<void> {
  await tx
    .update(matterDocuments)
    .set({ legalHold: hold, updatedAt: new Date() })
    .where(eq(matterDocuments.id, id));
}
