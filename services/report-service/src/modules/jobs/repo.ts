/**
 * jobs repo — Drizzle queries against domain schema ONLY.
 */
import { and, eq } from "drizzle-orm";
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
    downloadUrl: r.downloadUrl,
    resultColumns: r.resultColumns ?? null,
    resultPreview: r.resultPreview ?? null,
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

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<JobView[]> {
  const rows = await readScoped(tenantId, (tx) => tx.select().from(jobs)
    .where(eq(jobs.tenantId, tenantId))
    .limit(limit)
    .offset(offset));
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: JobInsert): Promise<void> {
  await tx.insert(jobs).values(row);
}

export { toView };
