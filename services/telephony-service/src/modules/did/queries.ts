/** DID mapping query handlers (READ PATH) — tenant-scoped read-through cache. */
import { cache } from "../../shared/infra.js";
import { DID_RESOURCE, DID_ACTIVE_MAPPINGS_CACHE } from "../../topics.js";
import * as repo from "./repo.js";
import type { DidMappingView } from "./schema.js";

export async function getMapping(id: string, tenantId: string): Promise<DidMappingView | null> {
  return cache.getOrLoad<DidMappingView>(cache.makeKey(tenantId, DID_RESOURCE, id), () => repo.findById(id, tenantId));
}

export async function listMappings(
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ data: DidMappingView[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  return cache.listOrLoad(tenantId, DID_RESOURCE, `list:${limit}:${offset}`, async () => {
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

/**
 * Load all active DID mappings for tenant resolution.
 * Used by the webhook routes to resolve inbound calls.
 */
export async function loadActiveMappings(): Promise<DidMappingView[]> {
  const result = await cache.getOrLoad<DidMappingView[]>(
    DID_ACTIVE_MAPPINGS_CACHE,
    () => repo.listAllActive(),
    60, // refresh every 60s
  );
  return result ?? [];
}
