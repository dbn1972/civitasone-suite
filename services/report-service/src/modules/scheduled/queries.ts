/**
 * Query handlers (READ PATH) — read-through cache for scheduled reports.
 */
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { ScheduledReportView } from "./schema.js";

const RESOURCE = "scheduled";

export async function getScheduledReport(tenantId: string, id: string): Promise<ScheduledReportView | null> {
  return cache.getOrLoad(cache.makeKey(tenantId, RESOURCE, id), () => repo.findById(id, tenantId));
}

export async function listScheduledReports(
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ data: ScheduledReportView[] }> {
  return cache.listOrLoad(tenantId, RESOURCE, `list:${limit}:${offset}`, async () => {
    const rows = await repo.listByTenant(tenantId, limit, offset);
    return { data: rows };
  });
}
