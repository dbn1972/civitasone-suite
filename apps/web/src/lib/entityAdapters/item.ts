import type { PickerEntry } from "@/app/(app)/inventory/linkHelpers";

/**
 * Item-picker adapter (GAP-INVENTORY-DETAIL-04 / GAP-INVENTORY-LIST-02): ONE search over BOTH
 * item masters. The server (GET /v1/inventory/item-picker) merges the inventory-service item
 * master and the stock-service item master, and returns a linked pair as a single entry, so
 * a user never sees the same item twice. Returns [] on any non-ok response.
 */
export type ItemMasters = "all" | "stock";

export async function searchItemEntries(
  query: string,
  signal: AbortSignal,
  masters: ItemMasters = "all",
): Promise<PickerEntry[]> {
  const qs = new URLSearchParams({ q: query, limit: "20", masters });
  const res = await fetch(`/api/proxy/v1/inventory/item-picker?${qs.toString()}`, { signal });
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: PickerEntry[] };
  return Array.isArray(body.data) ? body.data : [];
}

/**
 * The picker entry for a known stock-service item id (the stock register links by stock id), so a
 * form preselected from /inventory/<stockId> can show the single merged item. Null when unknown.
 */
export async function resolveStockItemEntry(stockItemId: string): Promise<PickerEntry | null> {
  const stockRes = await fetch(`/api/proxy/v1/stock/items/${encodeURIComponent(stockItemId)}`);
  if (!stockRes.ok) return null;
  const stock = (await stockRes.json()) as { id?: string; code?: string; itemCode?: string; name?: string };
  const stockCode = stock.code ?? stock.itemCode ?? null;
  const stockName = stock.name ?? null;
  if (!stock.id || !stockName) return null;

  const linkRes = await fetch(`/api/proxy/v1/inventory/item-links/lookup?stockItemId=${encodeURIComponent(stockItemId)}`);
  if (linkRes.ok) {
    const link = ((await linkRes.json()) as { data?: { inventoryItemId?: string } | null }).data;
    if (link?.inventoryItemId) {
      const invRes = await fetch(`/api/proxy/v1/inventory/items/${encodeURIComponent(link.inventoryItemId)}`);
      if (invRes.ok) {
        const inv = (await invRes.json()) as { id?: string; name?: string; sku?: string | null };
        if (inv.id && inv.name) {
          return {
            key: inv.id, kind: "linked", inventoryItemId: inv.id, stockItemId: stock.id,
            code: (inv.sku ?? "").trim() || stockCode || "-", name: inv.name, stockCode,
          };
        }
      }
    }
  }
  return {
    key: stock.id, kind: "stock_only", inventoryItemId: null, stockItemId: stock.id,
    code: stockCode ?? "-", name: stockName, stockCode,
  };
}
