import { eq, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { documentVersions, type DocumentVersionRow, type DocumentVersionInsert, type DocumentVersionView } from "./schema.js";

const RESOURCE = "document-version";

export function toView(r: DocumentVersionRow): DocumentVersionView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    documentId: r.documentId,
    versionNo: r.versionNo,
    s3Key: r.s3Key,
    sizeBytes: r.sizeBytes,
    changeNote: r.changeNote,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  };
}

export async function listByDocument(tenantId: string, documentId: string, limit: number, offset: number): Promise<DocumentVersionView[]> {
  return cache.listOrLoad(tenantId, RESOURCE, `doc:${documentId}:${limit}:${offset}`, async () => {
    const rows = await scopedRead((tx) =>
      tx.select().from(documentVersions)
        .where(and(eq(documentVersions.tenantId, tenantId), eq(documentVersions.documentId, documentId)))
        .orderBy(desc(documentVersions.versionNo))
        .limit(limit)
        .offset(offset)
    );
    return rows.map(toView);
  });
}

export async function getById(tenantId: string, id: string): Promise<DocumentVersionView | null> {
  return cache.getOrLoad(cache.makeKey(tenantId, RESOURCE, id), async () => {
    const rows = await scopedRead((tx) =>
      tx.select().from(documentVersions)
        .where(and(eq(documentVersions.id, id), eq(documentVersions.tenantId, tenantId)))
    );
    if (!rows.length) return null;
    return toView(rows[0]!);
  });
}

export async function getLatestVersionNo(tenantId: string, documentId: string): Promise<number> {
  const rows = await scopedRead((tx) =>
    tx.select({ versionNo: documentVersions.versionNo })
      .from(documentVersions)
      .where(and(eq(documentVersions.tenantId, tenantId), eq(documentVersions.documentId, documentId)))
      .orderBy(desc(documentVersions.versionNo))
      .limit(1)
  );
  return rows.length ? rows[0]!.versionNo : 0;
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/*
 * TX-001 -- tenant-scoped sibling of getById()/getLatestVersionNo(). Both are
 * db.transaction()-wrapped reads (via scopedRead) that open their OWN pool
 * connection; called from INSIDE the already-open outer db.transaction() in
 * versions/consumer.ts's versionRestore handler, each nested call blocks on a
 * second connection from the same pool and deadlocks it silently under load.
 * Route every read that happens inside an already-open consumer transaction
 * through these, not getById()/getLatestVersionNo() -- and deliberately skip
 * the cache layer here: a cache hit could hand back a value from outside the
 * caller's transaction snapshot, and a cache miss would re-enter scopedRead's
 * own db.transaction() right back into the same deadlock.
 */
export async function getByIdTx(tx: Writer, tenantId: string, id: string): Promise<DocumentVersionView | null> {
  const rows = await tx.select().from(documentVersions)
    .where(and(eq(documentVersions.id, id), eq(documentVersions.tenantId, tenantId)));
  if (!rows.length) return null;
  return toView(rows[0] as DocumentVersionRow);
}

export async function getLatestVersionNoTx(tx: Writer, tenantId: string, documentId: string): Promise<number> {
  const rows = await tx.select({ versionNo: documentVersions.versionNo })
    .from(documentVersions)
    .where(and(eq(documentVersions.tenantId, tenantId), eq(documentVersions.documentId, documentId)))
    .orderBy(desc(documentVersions.versionNo))
    .limit(1);
  return rows.length ? (rows[0] as { versionNo: number }).versionNo : 0;
}


export async function insert(tx: Writer, row: DocumentVersionInsert): Promise<void> {
  await tx.insert(documentVersions).values(row);
}
