import { eq, desc, isNull, ilike, and } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { files, type FileRow, type FileInsert, type FileView } from "./schema.js";

export function toView(r: FileRow): FileView {
  return {
    id:         r.id,
    tenantId:   r.tenantId,
    folderId:   r.folderId,
    name:       r.name,
    mimeType:   r.mimeType,
    sizeBytes:  r.sizeBytes,
    storageKey: r.storageKey,
    tags:       r.tags ?? [],
    status:     r.status,
    version:    r.version,
    createdAt:  r.createdAt,
    updatedAt:  r.updatedAt,
  };
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<FileView[]> {
  const rows = await scopedRead((tx) =>
    tx.select().from(files)
      .where(and(eq(files.tenantId, tenantId), isNull(files.deletedAt)))
      .orderBy(desc(files.updatedAt))
      .limit(limit).offset(offset)
  );
  return rows.map(toView);
}

export async function listByFolder(tenantId: string, folderId: string | null, limit: number, offset: number): Promise<FileView[]> {
  const cond = folderId
    ? and(eq(files.tenantId, tenantId), eq(files.folderId, folderId), isNull(files.deletedAt))
    : and(eq(files.tenantId, tenantId), isNull(files.folderId), isNull(files.deletedAt));
  const rows = await scopedRead((tx) =>
    tx.select().from(files).where(cond).orderBy(desc(files.updatedAt)).limit(limit).offset(offset)
  );
  return rows.map(toView);
}

export async function getById(tenantId: string, id: string): Promise<FileView | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(files).where(and(eq(files.tenantId, tenantId), eq(files.id, id))).limit(1)
  );
  return rows[0] ? toView(rows[0]) : null;
}

export async function searchByTenant(tenantId: string, query: string, limit: number): Promise<FileView[]> {
  const rows = await scopedRead((tx) =>
    tx.select().from(files)
      .where(and(eq(files.tenantId, tenantId), ilike(files.name, `%${query}%`), isNull(files.deletedAt)))
      .orderBy(desc(files.updatedAt))
      .limit(limit)
  );
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: FileInsert): Promise<void> {
  await tx.insert(files).values(row);
}

export async function softDelete(tx: Writer, tenantId: string, id: string, actorId: string): Promise<void> {
  await tx.update(files)
    .set({ deletedAt: new Date(), updatedBy: actorId, status: "deleted" })
    .where(and(eq(files.tenantId, tenantId), eq(files.id, id)));
}

export async function updateTags(tx: Writer, tenantId: string, id: string, tags: string[], actorId: string): Promise<void> {
  await tx.update(files)
    .set({ tags, updatedBy: actorId, updatedAt: new Date() })
    .where(and(eq(files.tenantId, tenantId), eq(files.id, id)));
}

export async function updateFolder(tx: Writer, tenantId: string, id: string, folderId: string | null, actorId: string): Promise<void> {
  await tx.update(files)
    .set({ folderId, updatedBy: actorId, updatedAt: new Date() })
    .where(and(eq(files.tenantId, tenantId), eq(files.id, id)));
}
