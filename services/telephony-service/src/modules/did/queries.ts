/** DID mapping query handlers (READ PATH) — tenant-scoped read-through cache. */
import { cache } from "../../shared/infra.js";
import { DID_RESOURCE, DID_NUMBER_CACHE_PREFIX } from "../../topics.js";
import * as repo from "./repo.js";
import { resolveTenant, normalizeNumber, DEFAULT_TENANT_ID } from "./domain.js";
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
 * Resolve the tenant that owns a dialed number, for inbound carrier webhooks.
 *
 * Cached per normalised number rather than as one global "all active mappings"
 * list: the list variant needed a cross-tenant read of the whole table, which
 * FORCE RLS correctly refuses, so inbound routing could never resolve a tenant.
 * Falls back to DEFAULT_TENANT_ID when the number has no active mapping.
 */
export async function resolveTenantForNumber(calleeNumber: string): Promise<string> {
  if (!calleeNumber) return DEFAULT_TENANT_ID;
  const normalized = normalizeNumber(calleeNumber);
  const mappings = await cache.getOrLoad(
    `${DID_NUMBER_CACHE_PREFIX}${normalized}`,
    () => repo.findMappingsForNumber(normalized),
    60,
  );
  return resolveTenant(calleeNumber, mappings ?? [], DEFAULT_TENANT_ID);
}
