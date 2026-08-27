/**
 * Query handlers (READ PATH).
 * Rule (CLAUDE.md §6): always read-through the cache; only fall back to Postgres on a miss.
 */
import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { TenantView } from "./domain.js";
import type { TenantQuotaView } from "./repo.js";
import type { UpdateQuotasBody } from "./validators.js";

export async function getTenant(id: string): Promise<TenantView | null> {
  return cache.getOrLoad<TenantView>(cache.makeKey(id, RESOURCE, id), () => repo.findById(id));
}

export async function getTenantByDomain(tenantId: string, domain: string): Promise<TenantView | null> {
  return cache.getOrLoad<TenantView>(
    cache.makeKey(tenantId, `${RESOURCE}_by_domain`, domain),
    () => repo.findByDomain(tenantId, domain)
  );
}

export async function getQuotas(tenantId: string): Promise<TenantQuotaView> {
  const cached = await cache.getOrLoad<TenantQuotaView>(
    cache.makeKey(tenantId, "quotas", tenantId),
    () => repo.findQuotas(tenantId),
  );
  // findQuotas always returns a result (defaults if no row), so cached is never null
  return cached!;
}

export async function updateQuotas(tenantId: string, patch: UpdateQuotasBody): Promise<TenantQuotaView> {
  const updated = await repo.upsertQuotas(tenantId, patch);
  // Invalidate the cached quotas
  await cache.invalidate(cache.makeKey(tenantId, "quotas", tenantId));
  return updated;
}
