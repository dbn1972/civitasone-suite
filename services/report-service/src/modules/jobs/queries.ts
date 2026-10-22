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
  offset: number,
  ownerId?: string,
): Promise<{ data: JobView[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  return cache.listOrLoad(tenantId, RESOURCE, `list:${ownerId ?? "all"}:${limit}:${offset}`, async () => {
    const rows = await repo.listByTenant(tenantId, limit, offset, ownerId);
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

/**
 * GAP2-REPORTS-PAGINATION-01: the true tenant-scoped job count for meta.total.
 * Cached under a distinct key so it does not collide with the paginated list.
 */
export async function countJobs(tenantId: string, ownerId?: string): Promise<number> {
  const n = await cache.getOrLoad(
    cache.makeKey(tenantId, RESOURCE, ownerId ? `count:${ownerId}` : "count"),
    () => repo.countByTenant(tenantId, ownerId),
    60,
  );
  return n ?? 0;
}
