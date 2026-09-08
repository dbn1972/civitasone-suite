import * as repo from "./repo.js";
import * as catalogueQueries from "../catalogue/queries.js";
import type { CitizenRequestRow } from "./schema.js";

export async function getRequestWithOwner(tenantId: string, id: string): Promise<CitizenRequestRow | null> {
  return repo.findRequestById(id, tenantId);
}

export async function listRequests(tenantId: string, limit: number, offset: number, status?: string, citizenId?: string): Promise<CitizenRequestRow[]> {
  return repo.listRequestsByTenant(tenantId, limit, offset, status, citizenId);
}

export async function getRequestStatus(tenantId: string, id: string) {
  const request = await repo.findRequestById(id, tenantId);
  if (!request) return null;
  const history = await repo.listStatusHistory(tenantId, id);
  return {
    id: request.id,
    status: request.status,
    updatedAt: request.updatedAt,
    history: history.map((h) => ({
      fromStatus: h.fromStatus, toStatus: h.toStatus, note: h.note, createdAt: h.createdAt,
    })),
  };
}

const ACTIVE_STATUSES = ["submitted", "under_review", "in_progress"];

/**
 * Real citizen-portal metrics, computed from genuine queries:
 *  - totalServices: government services actually published in the catalogue
 *    (catalogue.browsePublished), not a request-table count.
 *  - activeRequests / resolvedThisMonth / avgResolutionDays: derived from
 *    requests.citizen_requests for the tenant.
 * Field names match the pre-existing (previously fabricated) response shape
 * in modules/gap/routes.ts so the frontend contract is unchanged.
 */
export async function getPortalMetrics(tenantId: string): Promise<{
  totalServices: number; activeRequests: number; resolvedThisMonth: number; avgResolutionDays: number;
}> {
  const [published, activeRequests, resolvedStats] = await Promise.all([
    catalogueQueries.browsePublished(tenantId),
    repo.countByStatuses(tenantId, ACTIVE_STATUSES),
    repo.resolvedThisMonthStats(tenantId),
  ]);
  return {
    totalServices: published.length,
    activeRequests,
    resolvedThisMonth: resolvedStats.count,
    avgResolutionDays: Math.round(resolvedStats.avgResolutionDays * 10) / 10,
  };
}
