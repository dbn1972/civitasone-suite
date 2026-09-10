import { eq, and, desc, sql } from "drizzle-orm";
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
export type LockingTx = Writer & Pick<typeof db, "execute">;

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

/*
 * TX-016 -- serialize concurrent version-number allocation per document.
 * getLatestVersionNoTx() + 1 (above) is a plain read-then-insert with no
 * lock: two concurrent versionRestore/versionCreate consumer transactions
 * for the SAME document can both read the same latest versionNo and then
 * race the unique (tenant_id, document_id, version_no) index on insert --
 * one loses and errors the whole command into the DLQ instead of getting
 * a distinct version number.
 *
 * document_versions has no stable "latest" row to lock (it is append-only:
 * once a new version lands, whatever row a concurrent caller locked is no
 * longer latest, so SELECT ... FOR UPDATE against it serializes nothing),
 * and document_id carries no FK to a documents row either (see
 * migrations/0011_missing_module_tables.sql) -- there is no physical row
 * guaranteed to exist that represents "this document" to lock. A
 * session-scoped advisory lock keyed on (tenantId, documentId) needs
 * neither: same pattern as hrms-service ledger balance lock
 * (services/hrms-service/src/modules/cpf/repo.ts, lockedBalance()).
 * pg_advisory_xact_lock auto-releases at transaction end (commit or
 * rollback), so a crashed/rolled-back handler can never leave it held.
 *
 * Call this BEFORE getLatestVersionNoTx() in the same transaction, for
 * every command that allocates a version number for a document.
 */
export async function lockVersionSeq(tx: LockingTx, tenantId: string, documentId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}::text || ':' || ${documentId}::text, 0))`);
}

