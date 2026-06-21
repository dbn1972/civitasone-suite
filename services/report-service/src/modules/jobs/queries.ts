/**
 * Query handlers (READ PATH) — read-through cache.
 */
import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { JobView } from "./schema.js";

export async function getJob(tenantId: string, id: string): Promise<JobView | null> {
  return cache.getOrLoad(
    cache.makeKey(tenantId, RESOURCE, id),
    () => repo.findById(id, tenantId),
  );
}

export async function listJobs(
  tenantId: string,
  limit: number,
  offset: number
): Promise<{ data: JobView[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
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
