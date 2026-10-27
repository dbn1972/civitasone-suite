import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { ItemWithUom, ItemListRow } from "./repo.js";
import type { ItemCategoryRow, UomRow } from "./schema.js";

export async function getItem(tenantId: string, id: string): Promise<ItemWithUom | null> {
  const row = await cache.getOrLoad(
    cache.makeKey(tenantId, "item", id),
    () => repo.findItemWithUomById(id, tenantId)
  );
  // Defense-in-depth: guard against a cross-tenant cache hit.
  return row && row.tenantId === tenantId ? row : null;
}

/** Item list row as served: category name joined, plus the UOM code the web list shows (GAP-STOCK-LIST-02). */
export type ItemListEntry = ItemListRow & { uomCode: string | null };

export async function listItems(tenantId: string, opts?: { category?: string; q?: string; limit?: number; offset?: number }): Promise<ItemListEntry[]> {
  const key = cache.listKey(tenantId, "item", JSON.stringify(opts ?? {}));
  const items = (await cache.getOrLoad(key, () => repo.findItemsWithUomByTenant(tenantId, opts))) ?? [];
  return items.map((i) => ({ ...i, uomCode: i.uom }));
}

export async function listCategories(tenantId: string): Promise<ItemCategoryRow[]> {
  const key = cache.listKey(tenantId, "stock-category", "all");
  return (await cache.getOrLoad(key, () => repo.findCategoriesByTenant(tenantId))) ?? [];
}

export async function listUoms(tenantId: string): Promise<UomRow[]> {
  const key = cache.listKey(tenantId, "stock-uom", "all");
  return (await cache.getOrLoad(key, () => repo.findUomsByTenant(tenantId))) ?? [];
}

/** Not cached: balances change with every stock entry and this is a low-traffic detail read. */
export async function getItemBalances(tenantId: string, id: string): Promise<repo.ItemBalances> {
  return repo.findItemBalances(id, tenantId);
}
