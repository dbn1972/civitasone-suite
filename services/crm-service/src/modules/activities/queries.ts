import { cache } from "../../shared/infra.js";
const RESOURCE = "activity";
import * as repo from "./repo.js";
import type { ActivityView } from "./schema.js";

export async function listActivities(
  tenantId: string,
  limit: number,
  offset: number
): Promise<{ data: ActivityView[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  return cache.listOrLoad(tenantId, RESOURCE, `list:${limit}:${offset}`, async () => {
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
