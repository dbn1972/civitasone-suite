import { cache } from "../../shared/infra.js";
const RESOURCE = "deal";
import * as repo from "./repo.js";
import type { DealView } from "./schema.js";

export async function getDeal(id: string, tenantId: string): Promise<DealView | null> {
  return cache.getOrLoad<DealView>(
    cache.makeKey(tenantId, RESOURCE, id),
    () => repo.findById(id, tenantId)
  );
}

/**
 * Drop a deal's cached entity + list variants.
 *
 * Exported for G12: linking an opportunity to a programme writes crm.deals from the
 * programmes consumer, and a write that does not invalidate here would leave the deal read
 * path serving a pre-link snapshot for up to the cache TTL. Keeping the key knowledge in
 * this file means no other module has to hardcode the deal cache key.
 */
export async function invalidateDeal(tenantId: string, id: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, RESOURCE, id));
  await cache.invalidateResource(tenantId, RESOURCE);
}

export async function listDeals(
  tenantId: string,
  limit: number,
  offset: number
): Promise<{ data: DealView[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
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
