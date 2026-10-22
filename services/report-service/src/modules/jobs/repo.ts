/**
 * jobs repo — Drizzle queries against domain schema ONLY.
 */
import { and, eq, count } from "drizzle-orm";
import { db, readScoped } from "../../shared/db.js";
import { jobs, type JobRow, type JobInsert, type JobView } from "./schema.js";

function toView(r: JobRow): JobView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    reportType: r.reportType,
    status: r.status,
    format: r.format,
    rowCount: r.rowCount,
    requestedBy: r.requestedBy,
    completedAt: r.completedAt,
    createdAt: r.createdAt,
    downloadUrl: r.downloadUrl,
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<JobView | null> {
  const rows = await readScoped(tenantId, (tx) =>
    tx.select().from(jobs).where(and(eq(jobs.id, id), eq(jobs.tenantId, tenantId))).limit(1));
  const row = rows[0];
  if (!row) return null;
  return toView(row);
}

/** ownerId set => only that requester's jobs (non-admin); undefined => tenant-wide. */
export async function listByTenant(tenantId: string, limit: number, offset: number, ownerId?: string): Promise<JobView[]> {
  const rows = await readScoped(tenantId, (tx) => tx.select().from(jobs)
    .where(ownerId ? and(eq(jobs.tenantId, tenantId), eq(jobs.requestedBy, ownerId)) : eq(jobs.tenantId, tenantId))
    .limit(limit)
    .offset(offset));
  return rows.map(toView);
}

/**
 * GAP2-REPORTS-PAGINATION-01: tenant-scoped total row count, so meta.total
 * reflects the TRUE number of jobs rather than the length of the capped page.
 */
export async function countByTenant(tenantId: string, ownerId?: string): Promise<number> {
  const rows = await readScoped(tenantId, (tx) =>
    tx.select({ value: count() }).from(jobs)
      .where(ownerId ? and(eq(jobs.tenantId, tenantId), eq(jobs.requestedBy, ownerId)) : eq(jobs.tenantId, tenantId)));
  return Number(rows[0]?.value ?? 0);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: JobInsert): Promise<void> {
  await tx.insert(jobs).values(row);
}

export { toView };
