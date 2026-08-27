import { eq, desc, ilike, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { tenantTransaction } from "@civitasone/db";
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

// Returns whether a row was actually found and updated (false = no matching
// document for this tenant/id -- see updateStatusDirect's caller for why
// this matters).
export async function updateStatus(tx: Writer, tenantId: string, id: string, status: string): Promise<boolean> {
  const updated = await tx.update(documents)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(documents.tenantId, tenantId), eq(documents.id, id)))
    .returning({ id: documents.id });
  return updated.length > 0;
}

export async function updateStatusDirect(tenantId: string, id: string, status: string): Promise<boolean> {
  // Bug fix (deep-verify sweep), revised after independent review caught
  // that the first version of this fix was itself still a no-op in
  // practice: this originally called bare db.update(...) directly, which
  // bypasses wrapWithTenantGuc (only db.transaction() sets app.tenant_id,
  // and only by reading it out of AsyncLocalStorage via getCurrentTenantId()).
  // The fix's first revision switched to db.transaction(...), on the
  // assumption that AsyncLocalStorage would already be populated for any
  // authenticated request. It is NOT: this service's only hook that
  // populates it (createTenantTxHook, registered in app.ts) reads
  // EXCLUSIVELY from the req.headers['x-tenant-id'] header, which
  // Bearer-JWT-authenticated requests (the actual, real request path, via
  // resolveContext() extracting `tid` from the JWT) never send -- so
  // db.transaction() alone would have run this same write with app.tenant_id
  // still unset, reproducing the identical bug via a different gap.
  //
  // documents carries FORCE ROW LEVEL SECURITY with tenant_isolation_policy
  // USING/WITH CHECK (tenant_id = current_tenant_id()) -- with no GUC set,
  // current_tenant_id() is NULL and the policy silently matches zero rows.
  // Confirmed live against the dev DB before this: a bare UPDATE with no GUC
  // set reported "UPDATE 0" and left the row unchanged, while the identical
  // UPDATE with app.tenant_id set correctly reported "UPDATE 1".
  //
  // Correct fix: use tenantTransaction(db, tenantId, fn) (@civitasone/db),
  // which sets the GUC directly from the tenantId parameter this function
  // already has in hand -- no header or AsyncLocalStorage dependency at
  // all. This matches the pattern already used the same way in
  // revenue-service, crm-service, project-service, and finance-service.
  //
  // Also returns whether a row was actually matched (see the type change
  // above): the previous version returned void unconditionally, so a
  // nonexistent/foreign-tenant id would ALSO silently "succeed" -- the same
  // fake-success shape as the GUC bug, just triggered by a bad id instead.
  // The caller (queries.setDocumentStatus) is responsible for turning
  // `false` into a real 404 rather than a 200.
  return tenantTransaction(db, tenantId, (tx) => updateStatus(tx as Writer, tenantId, id, status));
}
