import { eq, desc, ilike, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { documents, type DocumentRow, type DocumentInsert, type DocumentView } from "./schema.js";

export function toView(r: DocumentRow): DocumentView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    title: r.title,
    category: r.category,
    status: r.status,
    tags: r.tags ?? [],
    accessLevel: r.accessLevel ?? "internal",
    fileType: r.fileType,
    fileSize: r.fileSize,
    author: r.author,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    version: r.version,
  };
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<DocumentView[]> {
  const rows = await scopedRead((tx) =>
    tx.select().from(documents)
      .where(eq(documents.tenantId, tenantId))
      .orderBy(desc(documents.updatedAt))
      .limit(limit)
      .offset(offset)
  );
  return rows.map(toView);
}

export async function searchByTenant(
  tenantId: string,
  query: string,
  category: string | undefined,
  limit: number,
): Promise<DocumentView[]> {
  const conditions = [
    eq(documents.tenantId, tenantId),
    ilike(documents.title, `%${query}%`),
    ...(category ? [eq(documents.category, category)] : []),
  ];
  const rows = await scopedRead((tx) =>
    tx.select().from(documents)
      .where(and(...conditions))
      .orderBy(desc(documents.updatedAt))
      .limit(limit)
  );
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: DocumentInsert): Promise<void> {
  await tx.insert(documents).values(row);
}

export async function getById(tenantId: string, id: string): Promise<DocumentView | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(documents)
      .where(and(eq(documents.tenantId, tenantId), eq(documents.id, id)))
      .limit(1)
  );
  return rows[0] ? toView(rows[0]) : null;
}

export async function listByCategory(tenantId: string, categoryId: string, limit: number, offset: number): Promise<DocumentView[]> {
  const rows = await scopedRead((tx) =>
    tx.select().from(documents)
      .where(and(eq(documents.tenantId, tenantId), eq(documents.category, categoryId)))
      .orderBy(desc(documents.updatedAt))
      .limit(limit)
      .offset(offset)
  );
  return rows.map(toView);
}

export async function updateStatus(tx: Writer, tenantId: string, id: string, status: string): Promise<void> {
  await tx.update(documents)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(documents.tenantId, tenantId), eq(documents.id, id)));
}

export async function updateStatusDirect(tenantId: string, id: string, status: string): Promise<void> {
  await db.update(documents)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(documents.tenantId, tenantId), eq(documents.id, id)));
}
