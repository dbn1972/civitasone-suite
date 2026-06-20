import { cache } from "../../shared/infra.js";
import { DASHBOARD_RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
export async function listDashboards(tenantId: string, limit: number, offset: number) {
  return cache.listOrLoad(tenantId, DASHBOARD_RESOURCE, `list:${limit}:${offset}`, async () => {
    const rows = await repo.listByTenant(tenantId, limit, offset);
    return { data: rows, pagination: { hasMore: rows.length === limit, pageSize: limit, ...(rows.length ? { cursor: String(offset + rows.length) } : {}) } };
  });
}
