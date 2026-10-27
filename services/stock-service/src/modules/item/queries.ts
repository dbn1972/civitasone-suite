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

/** Item list row as served: names joined, plus live stock figures (minor-unit money as strings). */
export type ItemListEntry = ItemListRow & {
  uomCode: string | null;
  currentStock: number;
  unitCost: string | null;
  totalValue: string;
};

export async function listItems(tenantId: string, opts?: { category?: string; q?: string; limit?: number; offset?: number }): Promise<ItemListEntry[]> {
  const key = cache.listKey(tenantId, "item", JSON.stringify(opts ?? {}));
  const items = (await cache.getOrLoad(key, () => repo.findItemsWithUomByTenant(tenantId, opts))) ?? [];
  // GAP-STOCK-LIST-04: balances change with every stock entry, so they are read per request
  // (one grouped query for the page) and overlaid on the cached item master rows.
  const totals = await repo.findStockTotals(tenantId, items.map((i) => i.id));
  return items.map((i) => {
    const t = totals.get(i.id);
    const qty = t?.qty ?? 0;
    const value = t?.valueMinor ?? 0n;
    return {
      ...i,
      uomCode: i.uom,
      currentStock: qty,
      totalValue: value.toString(),
      // Average cost per unit; only meaningful when there is stock on hand.
      unitCost: qty > 0 ? (value / BigInt(qty)).toString() : null,
    };
  });
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
