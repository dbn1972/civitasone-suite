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

// Fixes a fake-success bug -- full history and independent-review findings
// in PR #828. `documents` carries FORCE ROW LEVEL SECURITY keyed on
// app.tenant_id; this must run inside a transaction that sets that GUC from
// an explicit tenantId, not a bare db.update()/db.transaction() (those only
// get the GUC via AsyncLocalStorage, populated solely by createTenantTxHook
// reading req.headers['x-tenant-id'] -- present on real gateway-proxied
// traffic (services/gateway-service/src/jwt-edge.ts injects it from the
// JWT), but NOT on any path that reaches this service without that hop,
// e.g. this module's own read functions below when tested directly). Using
// tenantTransaction(db, tenantId, fn) here sidesteps that dependency
// entirely, matching the pattern already used in revenue-service,
// crm-service, project-service, and finance-service.
//
// Returns whether a row was actually matched: a nonexistent/foreign-tenant
// id must not silently "succeed" either (the caller turns `false` into 404).
export async function updateStatusDirect(tenantId: string, id: string, status: string): Promise<boolean> {
  return tenantTransaction(db, tenantId, (tx) => updateStatus(tx as Writer, tenantId, id, status));
}
