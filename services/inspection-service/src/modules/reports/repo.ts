/**
 * reports read queries — tenant-scoped via scopedRead().
 */
import { eq, and, type SQL } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { inspectionReports, observations } from "./schema.js";
import type { InspectionReportRow, ObservationRow } from "./schema.js";

export async function listReports(
  tenantId: string,
  opts: { inspectionId?: string; status?: string; page: number; pageSize: number },
): Promise<InspectionReportRow[]> {
  const conds: SQL[] = [eq(inspectionReports.tenantId, tenantId)];
  if (opts.inspectionId) conds.push(eq(inspectionReports.inspectionId, opts.inspectionId));
  if (opts.status) conds.push(eq(inspectionReports.status, opts.status));
  return scopedRead((tx) =>
    tx.select().from(inspectionReports)
      .where(and(...conds))
      .limit(opts.pageSize)
      .offset((opts.page - 1) * opts.pageSize),
  );
}

export async function findReportById(tenantId: string, id: string): Promise<InspectionReportRow | undefined> {
  const rows = await scopedRead((tx) =>
    tx.select().from(inspectionReports)
      .where(and(eq(inspectionReports.tenantId, tenantId), eq(inspectionReports.id, id)))
      .limit(1),
  );
  return rows[0];
}

export async function listObservations(tenantId: string, reportId: string): Promise<ObservationRow[]> {
  return scopedRead((tx) =>
    tx.select().from(observations)
      .where(and(eq(observations.tenantId, tenantId), eq(observations.reportId, reportId))),
  );
}
