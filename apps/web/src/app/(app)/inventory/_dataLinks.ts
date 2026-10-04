/**
 * Server loaders for the inventory <-> stock item cross-reference
 * (GAP-INVENTORY-DETAIL-04 / GAP-INVENTORY-LIST-02), through the gateway
 * (/api/v1/inventory/item-links* and /items/:id/stock-link). Server only.
 */
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import type {
  ItemLinkRow, ItemStockLinkDetail, LinkSuggestionRow, StockSideBalances, UnmatchedReport,
} from "./linkHelpers";

const LINK_PAGE = 200;
const LINK_MAX_PAGES = 10;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

export function mapLink(r: unknown): ItemLinkRow | null {
  if (!isRecord(r)) return null;
  const id = str(r.id);
  const inventoryItemId = str(r.inventoryItemId);
  const stockItemId = str(r.stockItemId);
  if (!id || !inventoryItemId || !stockItemId) return null;
  return {
    id, inventoryItemId, stockItemId,
    stockItemCode: str(r.stockItemCode) ?? "",
    stockItemName: str(r.stockItemName) ?? "",
    source: r.source === "suggested" ? "suggested" : "manual",
    linkedBy: str(r.linkedBy) ?? "",
    linkedAt: str(r.linkedAt) ?? "",
  };
}

/**
 * Every link of the tenant (paged). A failed page makes the whole result an error: a half list
 * would show linked items as "not linked".
 */
export async function getItemLinks(): Promise<LoaderResult<ItemLinkRow[]>> {
  const all: ItemLinkRow[] = [];
  for (let page = 0; page < LINK_MAX_PAGES; page += 1) {
    const res = await fetchJson<unknown, { rows: ItemLinkRow[]; total: number }>(
      `/api/v1/inventory/item-links?limit=${LINK_PAGE}&offset=${page * LINK_PAGE}`,
      { rows: [], total: 0 },
      {
        revalidateSeconds: 15,
        telemetryKey: "inventory.itemLinks",
        mapResponse: (payload) => {
          if (!isRecord(payload) || !Array.isArray(payload.data)) return null;
          const rows = payload.data.map(mapLink).filter((x): x is ItemLinkRow => x !== null);
          return { rows, total: typeof payload.total === "number" ? payload.total : rows.length };
        },
      },
    );
    if (res.source === "error") return { ...res, data: [] };
    all.push(...res.data.rows);
    if (all.length >= res.data.total || res.data.rows.length === 0) break;
  }
  return { data: all, source: "api" };
}

/** The link of one stock item (the stock register page), or null when it is not linked. */
export function getItemLinkByStock(stockItemId: string): Promise<LoaderResult<ItemLinkRow | null>> {
  return fetchJson<unknown, ItemLinkRow | null>(
    `/api/v1/inventory/item-links/lookup?stockItemId=${encodeURIComponent(stockItemId)}`,
    null,
    {
      revalidateSeconds: 15,
      telemetryKey: "inventory.itemLinkByStock",
      mapResponse: (payload) => (isRecord(payload) && "data" in payload ? (payload.data === null ? null : mapLink(payload.data)) : null),
    },
  );
}

function mapBalances(v: unknown): StockSideBalances | null {
  if (!isRecord(v) || typeof v.totalQty !== "number" || !Array.isArray(v.warehouses)) return null;
  return {
    itemId: str(v.itemId) ?? "",
    totalQty: v.totalQty,
    totalValueMinor: str(v.totalValueMinor) ?? "0",
    warehouses: v.warehouses.filter(isRecord).map((w) => ({
      warehouseId: str(w.warehouseId) ?? "",
      qty: typeof w.qty === "number" ? w.qty : 0,
      rateMinor: str(w.rateMinor) ?? "0",
      valueMinor: str(w.valueMinor) ?? "0",
    })),
  };
}

export function getItemStockLink(itemId: string): Promise<LoaderResult<ItemStockLinkDetail | null>> {
  return fetchJson<unknown, ItemStockLinkDetail | null>(
    `/api/v1/inventory/items/${encodeURIComponent(itemId)}/stock-link`,
    null,
    {
      revalidateSeconds: 15,
      telemetryKey: "inventory.itemStockLink",
      mapResponse: (payload) => {
        const d = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
        if (!d || typeof d.linked !== "boolean") return null;
        const stockRaw = isRecord(d.stock) ? d.stock : null;
        const itemRaw = stockRaw && isRecord(stockRaw.item) ? stockRaw.item : null;
        const sug = isRecord(d.suggestion) ? d.suggestion : null;
        return {
          inventoryItemId: str(d.inventoryItemId) ?? itemId,
          linked: d.linked,
          link: mapLink(d.link),
          stock: stockRaw
            ? {
                item: itemRaw && str(itemRaw.id) ? { id: str(itemRaw.id)!, code: str(itemRaw.code) ?? "", name: str(itemRaw.name) ?? "", uom: str(itemRaw.uom) } : null,
                balances: mapBalances(stockRaw.balances),
              }
            : null,
          stockAvailable: d.stockAvailable !== false,
          suggestion: sug && str(sug.stockItemId)
            ? { stockItemId: str(sug.stockItemId)!, stockItemCode: str(sug.stockItemCode) ?? "", stockItemName: str(sug.stockItemName) ?? "" }
            : null,
        };
      },
    },
  );
}

export function getUnmatchedReport(): Promise<LoaderResult<UnmatchedReport | null>> {
  return fetchJson<unknown, UnmatchedReport | null>("/api/v1/inventory/item-links/unmatched?limit=500", null, {
    revalidateSeconds: 0,
    telemetryKey: "inventory.itemLinkUnmatched",
    mapResponse: (payload) => {
      if (!isRecord(payload) || !isRecord(payload.data) || !isRecord(payload.counts)) return null;
      const d = payload.data;
      const c = payload.counts;
      const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
      const inv = Array.isArray(d.inventoryOnly) ? d.inventoryOnly.filter(isRecord) : [];
      const stk = Array.isArray(d.stockOnly) ? d.stockOnly.filter(isRecord) : null;
      return {
        inventoryOnly: inv.flatMap((i) => (str(i.id) && str(i.name) ? [{ id: str(i.id)!, name: str(i.name)!, sku: str(i.sku), hasSuggestion: i.hasSuggestion === true }] : [])),
        stockOnly: stk
          ? stk.flatMap((s) => (str(s.id) && str(s.name) ? [{ id: str(s.id)!, code: str(s.code) ?? "", name: str(s.name)!, hasSuggestion: s.hasSuggestion === true }] : []))
          : null,
        counts: {
          inventoryTotal: num(c.inventoryTotal) ?? 0, inventoryLinked: num(c.inventoryLinked) ?? 0, inventoryUnlinked: num(c.inventoryUnlinked) ?? 0,
          stockTotal: num(c.stockTotal), stockLinked: num(c.stockLinked), stockUnlinked: num(c.stockUnlinked),
          suggestions: num(c.suggestions) ?? 0, ambiguous: num(c.ambiguous) ?? 0,
        },
        stockAvailable: payload.stockAvailable !== false,
        truncated: payload.truncated === true,
      };
    },
  });
}

export function getLinkSuggestions(): Promise<LoaderResult<{ rows: LinkSuggestionRow[]; ambiguous: number }>> {
  return fetchJson<unknown, { rows: LinkSuggestionRow[]; ambiguous: number }>("/api/v1/inventory/item-links/suggestions", { rows: [], ambiguous: 0 }, {
    revalidateSeconds: 0,
    telemetryKey: "inventory.itemLinkSuggestions",
    mapResponse: (payload) => {
      if (!isRecord(payload) || !Array.isArray(payload.data)) return null;
      const rows = payload.data.filter(isRecord).flatMap((s) =>
        str(s.inventoryItemId) && str(s.stockItemId)
          ? [{
              inventoryItemId: str(s.inventoryItemId)!, inventoryName: str(s.inventoryName) ?? "", sku: str(s.sku) ?? "",
              stockItemId: str(s.stockItemId)!, stockName: str(s.stockName) ?? "", stockCode: str(s.stockCode) ?? "",
            }]
          : []);
      return { rows, ambiguous: typeof payload.ambiguous === "number" ? payload.ambiguous : 0 };
    },
  });
}

export type InventoryItemDetail = {
  id: string; name: string; sku: string | null; status: string; category: string | null; uom: string | null;
  itemType: string; reorderLevel: number; reorderQty: number; unitCostMinor: string; hsnCode: string | null;
};

export function getInventoryItemDetail(id: string): Promise<LoaderResult<InventoryItemDetail | null>> {
  return fetchJson<unknown, InventoryItemDetail | null>(`/api/v1/inventory/items/${encodeURIComponent(id)}`, null, {
    revalidateSeconds: 15,
    telemetryKey: "inventory.itemDetail",
    mapResponse: (payload) => {
      if (!isRecord(payload) || !str(payload.id) || !str(payload.name)) return null;
      return {
        id: str(payload.id)!, name: str(payload.name)!, sku: str(payload.sku), status: str(payload.status) ?? "active",
        category: str(payload.category), uom: str(payload.uom), itemType: str(payload.itemType) ?? "consumable",
        reorderLevel: typeof payload.reorderLevel === "number" ? payload.reorderLevel : 0,
        reorderQty: typeof payload.reorderQty === "number" ? payload.reorderQty : 0,
        unitCostMinor: str(payload.unitCostMinor) ?? "0", hsnCode: str(payload.hsnCode),
      };
    },
  });
}
