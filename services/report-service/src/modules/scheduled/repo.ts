/**
 * scheduled repo — Drizzle queries against reports.scheduled_reports.
 */
import { eq, and } from "drizzle-orm";
import { db, readScoped } from "../../shared/db.js";
import {
  scheduledReports,
  type ScheduledReportRow,
  type ScheduledReportInsert,
  type ScheduledReportView,
} from "./schema.js";

function toView(r: ScheduledReportRow): ScheduledReportView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    templateId: r.templateId,
    cadence: r.cadence as ScheduledReportView["cadence"],
    recipients: (r.recipients ?? []) as string[],
    format: r.format,
    enabled: r.enabled,
    lastRunAt: r.lastRunAt,
    nextRunAt: r.nextRunAt,
    version: r.version,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
  };
}

export async function findById(id: string, tenantId: string): Promise<ScheduledReportView | null> {
  const rows = await readScoped(tenantId, (tx) =>
    tx
      .select()
      .from(scheduledReports)
      .where(and(eq(scheduledReports.id, id), eq(scheduledReports.tenantId, tenantId)))
      .limit(1),
  );
  const row = rows[0];
  if (!row) return null;
  return toView(row);
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
): Promise<ScheduledReportView[]> {
  const rows = await readScoped(tenantId, (tx) =>
    tx
      .select()
      .from(scheduledReports)
      .where(and(eq(scheduledReports.tenantId, tenantId), eq(scheduledReports.enabled, true)))
      .limit(limit)
      .offset(offset),
  );
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: ScheduledReportInsert): Promise<void> {
  await tx.insert(scheduledReports).values(row);
}

export async function update(
  tx: Writer,
  id: string,
  tenantId: string,
  currentVersion: number,
  data: Partial<Omit<ScheduledReportInsert, "id" | "tenantId" | "createdAt" | "createdBy">>,
): Promise<boolean> {
  const result = await tx
    .update(scheduledReports)
    .set({ ...data, version: currentVersion + 1, updatedAt: new Date() })
    .where(
      and(
        eq(scheduledReports.id, id),
        eq(scheduledReports.tenantId, tenantId),
        eq(scheduledReports.version, currentVersion),
      ),
    );
  return (result as unknown as { rowCount: number }).rowCount > 0;
}

export async function disable(tx: Writer, id: string, tenantId: string, actorId: string): Promise<boolean> {
  const result = await tx
    .update(scheduledReports)
    .set({ enabled: false, updatedAt: new Date(), updatedBy: actorId })
    .where(and(eq(scheduledReports.id, id), eq(scheduledReports.tenantId, tenantId)));
  return (result as unknown as { rowCount: number }).rowCount > 0;
}

export async function touchLastRunAt(
  tx: Writer,
  id: string,
  tenantId: string,
  actorId: string,
  at: Date,
): Promise<boolean> {
  const result = await tx
    .update(scheduledReports)
    .set({ lastRunAt: at, updatedAt: at, updatedBy: actorId })
    .where(and(eq(scheduledReports.id, id), eq(scheduledReports.tenantId, tenantId)));
  return (result as unknown as { rowCount: number }).rowCount > 0;
}

export { toView };
