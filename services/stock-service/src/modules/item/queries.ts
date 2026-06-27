import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { ItemWithUom } from "./repo.js";

export async function getItem(tenantId: string, id: string): Promise<ItemWithUom | null> {
  const row = await cache.getOrLoad(
    cache.makeKey(tenantId, "item", id),
    () => repo.findItemWithUomById(id, tenantId)
  );
  // Defense-in-depth: guard against a cross-tenant cache hit.
  return row && row.tenantId === tenantId ? row : null;
}

export async function listItems(tenantId: string, opts?: { category?: string; limit?: number; offset?: number }): Promise<ItemWithUom[]> {
  const key = cache.listKey(tenantId, "item", JSON.stringify(opts ?? {}));
  return (await cache.getOrLoad(key, () => repo.findItemsWithUomByTenant(tenantId, opts))) ?? [];
}
