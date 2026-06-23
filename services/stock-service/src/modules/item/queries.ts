import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { ItemWithUom } from "./repo.js";

export async function getItem(tenantId: string, id: string): Promise<ItemWithUom | null> {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "item", id),
    () => repo.findItemWithUomById(id)
  );
}

export async function listItems(tenantId: string, opts?: { category?: string; limit?: number; offset?: number }): Promise<ItemWithUom[]> {
  const key = cache.listKey(tenantId, "item", JSON.stringify(opts ?? {}));
  return (await cache.getOrLoad(key, () => repo.findItemsWithUomByTenant(tenantId, opts))) ?? [];
}
