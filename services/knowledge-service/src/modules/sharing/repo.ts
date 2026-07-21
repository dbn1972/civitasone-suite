import { eq, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { documentShares, type DocumentShareRow, type DocumentShareInsert, type DocumentShareView } from "./schema.js";

const RESOURCE = "share";

export function toView(r: DocumentShareRow): DocumentShareView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    documentId: r.documentId,
    sharedWith: r.sharedWith,
    permission: r.permission,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
    version: r.version,
  };
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<DocumentShareView[]> {
  return cache.listOrLoad(tenantId, RESOURCE, `list:${limit}:${offset}`, async () => {
    const rows = await scopedRead((tx) =>
      tx.select().from(documentShares)
        .where(eq(documentShares.tenantId, tenantId))
        .orderBy(desc(documentShares.createdAt))
        .limit(limit)
        .offset(offset)
    );
    return rows.map(toView);
  });
}

export async function listByDocument(tenantId: string, documentId: string): Promise<DocumentShareView[]> {
  const rows = await scopedRead((tx) =>
    tx.select().from(documentShares)
      .where(and(eq(documentShares.tenantId, tenantId), eq(documentShares.documentId, documentId)))
      .orderBy(desc(documentShares.createdAt))
  );
  return rows.map(toView);
}

export async function getById(tenantId: string, id: string): Promise<DocumentShareView | null> {
  return cache.getOrLoad(cache.makeKey(tenantId, RESOURCE, id), async () => {
    const rows = await scopedRead((tx) =>
      tx.select().from(documentShares)
        .where(and(eq(documentShares.id, id), eq(documentShares.tenantId, tenantId)))
    );
    if (!rows.length) return null;
    return toView(rows[0]!);
  });
}

export type Writer = Pick<typeof db, "insert" | "update" | "select" | "delete">;

export async function insert(tx: Writer, row: DocumentShareInsert): Promise<void> {
  await tx.insert(documentShares).values(row);
}

export async function remove(tx: Writer, id: string): Promise<void> {
  await tx.delete(documentShares).where(eq(documentShares.id, id));
}
