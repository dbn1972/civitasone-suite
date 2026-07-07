/**
 * exports/repo.ts — DB read functions for export jobs (tenant-scoped).
 * Uses the enhanced export_jobs schema from the exports module.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { exportJobs, type ExportJobRow } from "./schema.js";

export interface ExportJobReadView {
  id: string;
  tenantId: string;
  queryRunId: string | null;
  format: string;
  status: string;
  downloadUrl: string | null;
  error: string | null;
}

export function toReadView(r: ExportJobRow): ExportJobReadView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    queryRunId: r.queryRunId,
    format: r.format,
    status: r.status,
    downloadUrl: r.downloadUrl,
    error: r.error,
  };
}

export async function findById(id: string, tenantId: string): Promise<ExportJobReadView | null> {
  const rows = await db
    .select()
    .from(exportJobs)
    .where(and(eq(exportJobs.id, id), eq(exportJobs.tenantId, tenantId)))
    .limit(1);
  return rows[0] ? toReadView(rows[0]) : null;
}
