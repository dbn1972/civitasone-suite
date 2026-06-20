import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { ItemRow } from "./schema.js";

export async function getItem(tenantId: string, id: string): Promise<ItemRow | null> {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "item", id),
    () => repo.findItemById(id)
  );
}

export async function listItems(tenantId: string, opts?: { category?: string; limit?: number; offset?: number }): Promise<ItemRow[]> {
  const key = cache.listKey(tenantId, "item", JSON.stringify(opts ?? {}));
  return (await cache.getOrLoad(key, () => repo.findItemsByTenant(tenantId, opts))) ?? [];
}
