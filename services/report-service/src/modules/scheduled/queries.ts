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
  ownerId?: string,
): Promise<{ data: ScheduledReportView[] }> {
  return cache.listOrLoad(tenantId, RESOURCE, `list:${ownerId ?? "all"}:${limit}:${offset}`, async () => {
    const rows = await repo.listByTenant(tenantId, limit, offset, ownerId);
    return { data: rows };
  });
}

/**
 * GAP2-REPORTS-PAGINATION-01: the true tenant-scoped count of enabled
 * scheduled reports for meta.total.
 */
export async function countScheduledReports(tenantId: string, ownerId?: string): Promise<number> {
  const n = await cache.getOrLoad(
    cache.makeKey(tenantId, RESOURCE, ownerId ? `count:${ownerId}` : "count"),
    () => repo.countByTenant(tenantId, ownerId),
    60,
  );
  return n ?? 0;
}
