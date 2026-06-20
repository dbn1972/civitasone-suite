import { cache } from "../../shared/infra.js";
import { RESOURCE_TENANT } from "../../topics.js";
import * as repo from "./repo.js";
import type { TenantView } from "./domain.js";

export async function getTenant(id: string): Promise<TenantView | null> {
  return cache.getOrLoad<TenantView>(cache.makeKey(id, RESOURCE_TENANT, id), () => repo.findById(id));
}

export async function listTenants(page: number, limit: number) {
  return cache.getOrLoad(`admin:platform:tenants:list:${page}:${limit}`, () => repo.list(page, limit));
}
