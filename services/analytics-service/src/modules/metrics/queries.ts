/** saved metrics read handlers — read-through cache, tenant-scoped. */
import { cache } from "../../shared/infra.js";
import { METRIC_RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";

export async function listSavedMetrics(tenantId: string, limit: number, offset: number) {
  return cache.listOrLoad(tenantId, METRIC_RESOURCE, `list:${limit}:${offset}`, async () => {
    const rows = await repo.listByTenant(tenantId, limit, offset);
    return {
      data: rows,
      pagination: {
        hasMore: rows.length === limit,
        pageSize: limit,
        ...(rows.length ? { cursor: String(offset + rows.length) } : {}),
      },
    };
  });
}
