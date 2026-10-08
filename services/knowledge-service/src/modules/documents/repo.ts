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

/**
 * GAP2-KNOWLEDGE-RECORDS-01: a records projection that joins each document to
 * the retention policy applied to its category, so the Records Management
 * view can surface real `retentionPeriod` / `disposalDueDate` / `department`
 * instead of always-absent fields (which made the review/weeding KPIs
 * structurally always 0).
 *
 * The link is document.category (a category NAME/slug on the document) →
 * knowledge.categories (name OR slug) → knowledge.retention_policies.category_id.
 * When a document's category has no applied retention policy, retention fields
 * come back null and the page shows the honest "—"/unconfigured state.
 *
 * disposalDueDate = created_at + retention_years years + retention_days days.
 * A policy with retention_years >= 100 is treated as "Permanent" (no disposal
 * due date), matching the page's `retentionPeriod.includes("perm")` KPI.
 */
export type RecordProjection = {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
  department: string | null;
  retentionPeriod: string | null;
  disposalDueDate: string | null;
};

export async function listRecords(tenantId: string, limit: number, offset: number): Promise<RecordProjection[]> {
  const rows = await scopedRead(async (tx) => {
    // RLS on knowledge.documents/categories/retention_policies is keyed on the
    // app.tenant_id GUC. scopedRead already runs inside db.transaction (so the
    // request's tenant hook has set it), but this raw cross-table join reads
    // categories/retention_policies which are not in this service's drizzle
    // SCHEMA map — set the GUC explicitly to guarantee RLS admits the join on
    // every path (direct-test included), matching the admin-service/config
    // repo pattern.
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return tx.execute(sql`
      SELECT
        d.id,
        d.title,
        d.status,
        d.created_at AS "createdAt",
        c.name AS department,
        rp.retention_years AS "retentionYears",
        rp.retention_days  AS "retentionDays",
        rp.action          AS "retentionAction"
      FROM knowledge.documents d
      LEFT JOIN knowledge.categories c
        ON c.tenant_id = d.tenant_id
       AND (c.name = d.category OR c.slug = d.category)
      LEFT JOIN knowledge.retention_policies rp
        ON rp.tenant_id = d.tenant_id
       AND rp.category_id = c.id
      WHERE d.tenant_id = ${tenantId}
      ORDER BY d.updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
  });
  const data = (rows as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? (rows as unknown as Array<Record<string, unknown>>);
  return data.map((r) => {
    const retentionYears = r.retentionYears === null || r.retentionYears === undefined ? null : Number(r.retentionYears);
    const retentionDays = r.retentionDays === null || r.retentionDays === undefined ? 0 : Number(r.retentionDays);
    const createdAt = new Date(r.createdAt as string);
    let retentionPeriod: string | null = null;
    let disposalDueDate: string | null = null;
    if (retentionYears !== null) {
      if (retentionYears >= 100) {
        retentionPeriod = "Permanent";
      } else {
        retentionPeriod = `${retentionYears} year${retentionYears === 1 ? "" : "s"}`;
        const due = new Date(createdAt);
        due.setFullYear(due.getFullYear() + retentionYears);
        due.setDate(due.getDate() + retentionDays);
        disposalDueDate = due.toISOString().slice(0, 10);
      }
    }
    return {
      id: String(r.id),
      title: String(r.title),
      status: String(r.status),
      createdAt,
      department: r.department === null || r.department === undefined ? null : String(r.department),
      retentionPeriod,
      disposalDueDate,
    };
  });
}

/**
 * GAP2-KNOWLEDGE-DASHBOARD-CAP-01: server-side repository-wide aggregate so the
 * dashboard StatCards reflect TRUE totals instead of a count over the first
 * (page-capped) 50 documents. Returns the total, counts by status, counts by
 * category, and a derived circular count (category contains "circular").
 */
export type DocumentsSummary = {
  total: number;
  byStatus: Record<string, number>;
  byCategory: Array<{ category: string; count: number }>;
  circulars: number;
  active: number;
  archived: number;
};

export async function summarize(tenantId: string): Promise<DocumentsSummary> {
  return scopedRead(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    const statusRows = (await tx.execute(sql`
      SELECT status, count(*)::int AS n
      FROM knowledge.documents WHERE tenant_id = ${tenantId}
      GROUP BY status`)) as unknown as Array<{ status: string; n: number }>;
    const categoryRows = (await tx.execute(sql`
      SELECT coalesce(category, 'general') AS category, count(*)::int AS n
      FROM knowledge.documents WHERE tenant_id = ${tenantId}
      GROUP BY coalesce(category, 'general')
      ORDER BY count(*) DESC`)) as unknown as Array<{ category: string; n: number }>;

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const r of statusRows) {
      const n = Number(r.n);
      byStatus[r.status] = n;
      total += n;
    }
    const active = (byStatus["approved"] ?? 0) + (byStatus["under_review"] ?? 0);
    const archived = byStatus["archived"] ?? 0;
    const byCategory = categoryRows.map((r) => ({ category: String(r.category), count: Number(r.n) }));
    const circulars = byCategory
      .filter((c) => c.category.toLowerCase().includes("circular"))
      .reduce((s, c) => s + c.count, 0);
    return { total, byStatus, byCategory, circulars, active, archived };
  });
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
