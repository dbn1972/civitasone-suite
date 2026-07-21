/** queries repo — query runs, scheduled queries, export jobs. Tenant-scoped. */
import { and, eq, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  queryRuns,
  scheduledQueries,
  exportJobs,
  type QueryRunRow,
  type QueryRunInsert,
  type QueryRunView,
  type ScheduledRow,
  type ScheduledInsert,
  type ScheduledView,
  type ExportRow,
  type ExportInsert,
  type ExportView,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export function toView(r: QueryRunRow): QueryRunView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    dashboardId: r.dashboardId,
    queryName: r.queryName,
    status: r.status,
    kind: r.kind,
    spec: r.spec,
    result: r.result ?? null,
    resultRows: r.resultRows,
    error: r.error,
    version: r.version,
  };
}

export function toScheduledView(r: ScheduledRow): ScheduledView {
  return { id: r.id, tenantId: r.tenantId, name: r.name, spec: r.spec, cadence: r.cadence, enabled: r.enabled, version: r.version };
}

export function toExportView(r: ExportRow): ExportView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    queryRunId: r.queryRunId,
    format: r.format,
    status: r.status,
    rowCount: r.rowCount,
    downloadUrl: r.downloadUrl,
    version: r.version,
  };
}

// ── query runs ────────────────────────────────────────────────────────────
export async function insert(tx: Writer, row: QueryRunInsert): Promise<void> {
  await tx.insert(queryRuns).values(row);
}

export async function complete(
  tx: Writer,
  id: string,
  resultRows: number,
  result: Record<string, unknown>,
  actorId: string,
): Promise<void> {
  await tx
    .update(queryRuns)
    .set({ status: "completed", resultRows, result, updatedBy: actorId, updatedAt: new Date() })
    .where(eq(queryRuns.id, id));
}

export async function fail(tx: Writer, id: string, error: string, actorId: string): Promise<void> {
  await tx
    .update(queryRuns)
    .set({ status: "failed", error: error.slice(0, 500), updatedBy: actorId, updatedAt: new Date() })
    .where(eq(queryRuns.id, id));
}

export async function findById(id: string, tenantId: string): Promise<QueryRunView | null> {
  const rows = await scopedRead(async (tx) =>
    tx
      .select()
      .from(queryRuns)
      .where(and(eq(queryRuns.id, id), eq(queryRuns.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ? toView(rows[0]) : null;
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<QueryRunView[]> {
  const rows = await scopedRead(async (tx) =>
    tx
      .select()
      .from(queryRuns)
      .where(eq(queryRuns.tenantId, tenantId))
      .orderBy(desc(queryRuns.createdAt))
      .limit(limit)
      .offset(offset),
  );
  return rows.map(toView);
}

// ── scheduled queries ───────────────────────────────────────────────────────
export async function insertScheduled(tx: Writer, row: ScheduledInsert): Promise<void> {
  await tx.insert(scheduledQueries).values(row);
}

export async function listScheduled(tenantId: string, limit: number, offset: number): Promise<ScheduledView[]> {
  const rows = await scopedRead(async (tx) =>
    tx
      .select()
      .from(scheduledQueries)
      .where(eq(scheduledQueries.tenantId, tenantId))
      .orderBy(desc(scheduledQueries.updatedAt))
      .limit(limit)
      .offset(offset),
  );
  return rows.map(toScheduledView);
}

// ── export jobs ───────────────────────────────────────────────────────────
export async function insertExport(tx: Writer, row: ExportInsert): Promise<void> {
  await tx.insert(exportJobs).values(row);
}

export async function completeExport(
  tx: Writer,
  id: string,
  rowCount: number,
  downloadUrl: string,
  actorId: string,
): Promise<void> {
  await tx
    .update(exportJobs)
    .set({ status: "completed", rowCount, downloadUrl, updatedBy: actorId, updatedAt: new Date() })
    .where(eq(exportJobs.id, id));
}

export async function listExports(tenantId: string, limit: number, offset: number): Promise<ExportView[]> {
  const rows = await scopedRead(async (tx) =>
    tx
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.tenantId, tenantId))
      .orderBy(desc(exportJobs.createdAt))
      .limit(limit)
      .offset(offset),
  );
  return rows.map(toExportView);
}

export async function findExportById(id: string, tenantId: string): Promise<ExportView | null> {
  const rows = await scopedRead(async (tx) =>
    tx
      .select()
      .from(exportJobs)
      .where(and(eq(exportJobs.id, id), eq(exportJobs.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ? toExportView(rows[0]) : null;
}
