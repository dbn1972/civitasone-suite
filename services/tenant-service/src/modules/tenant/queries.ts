/**
 * Query handlers (READ PATH).
 * Rule (CLAUDE.md §6): always read-through the cache; only fall back to Postgres on a miss.
 */
import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { TenantView } from "./domain.js";

export async function getTenant(id: string): Promise<TenantView | null> {
  return cache.getOrLoad<TenantView>(cache.makeKey(id, RESOURCE, id), () => repo.findById(id));
}

export async function getTenantByDomain(tenantId: string, domain: string): Promise<TenantView | null> {
  return cache.getOrLoad<TenantView>(
    cache.makeKey(tenantId, `${RESOURCE}_by_domain`, domain),
    () => repo.findByDomain(domain)
  );
}
