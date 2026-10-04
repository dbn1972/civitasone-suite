/**
 * Pure helpers + shared types for the inventory <-> stock item cross-reference
 * (GAP-INVENTORY-DETAIL-04 / GAP-INVENTORY-LIST-02). No server-only imports, so client
 * components and tests can use it. Page files call these instead of testing `.length === 0`
 * on loader data inline.
 */

export type ItemLinkRow = {
  id: string;
  inventoryItemId: string;
  stockItemId: string;
  stockItemCode: string;
  stockItemName: string;
  source: "manual" | "suggested";
  linkedBy: string;
  linkedAt: string;
};

export type LinkSuggestion = { stockItemId: string; stockItemCode: string; stockItemName: string };

export type StockSideBalances = {
  itemId: string;
  totalQty: number;
  totalValueMinor: string;
  warehouses: Array<{ warehouseId: string; qty: number; rateMinor: string; valueMinor: string }>;
};

export type ItemStockLinkDetail = {
  inventoryItemId: string;
  linked: boolean;
  link: ItemLinkRow | null;
  /** Live stock-side item + balances; null when not linked or stock-service could not be read. */
  stock: { item: { id: string; code: string; name: string; uom: string | null } | null; balances: StockSideBalances | null } | null;
  /** False when stock-service could not be reached (the link itself is still real). */
  stockAvailable: boolean;
  suggestion: LinkSuggestion | null;
};

export type UnmatchedReport = {
  inventoryOnly: Array<{ id: string; name: string; sku: string | null; hasSuggestion: boolean }>;
  /** null when stock-service could not be read. */
  stockOnly: Array<{ id: string; code: string; name: string; hasSuggestion: boolean }> | null;
  counts: {
    inventoryTotal: number; inventoryLinked: number; inventoryUnlinked: number;
    stockTotal: number | null; stockLinked: number | null; stockUnlinked: number | null;
    suggestions: number; ambiguous: number;
  };
  stockAvailable: boolean;
  truncated: boolean;
};

export type LinkSuggestionRow = {
  inventoryItemId: string; inventoryName: string; sku: string;
  stockItemId: string; stockName: string; stockCode: string;
};

export type LinkState = "linked" | "unlinked" | "unknown";

/** `linkedIds` is null when the links could not be loaded: then nothing is claimed either way. */
export function linkState(id: string, linkedIds: ReadonlySet<string> | null): LinkState {
  if (linkedIds === null) return "unknown";
  return linkedIds.has(id) ? "linked" : "unlinked";
}

export const hasNoRows = (rows: readonly unknown[]): boolean => rows.length === 0;

/** Where choosing a picker entry should go: the stock register page when there is a stock side, else the item master page. */
export function entryHref(e: { inventoryItemId: string | null; stockItemId: string | null }): string {
  if (e.inventoryItemId) return `/inventory/items/${e.inventoryItemId}`;
  return `/inventory/${e.stockItemId ?? ""}`;
}

export type PickerEntry = {
  key: string;
  kind: "linked" | "inventory_only" | "stock_only";
  inventoryItemId: string | null;
  stockItemId: string | null;
  code: string;
  name: string;
  stockCode: string | null;
};

/** Total on-hand across warehouses and its value, in rupees for display, or nulls when unknown. */
export function balanceTotals(b: StockSideBalances | null): { qty: number; valueMinor: bigint } | null {
  if (!b) return null;
  try {
    return { qty: b.totalQty, valueMinor: BigInt(b.totalValueMinor) };
  } catch {
    return null;
  }
}
