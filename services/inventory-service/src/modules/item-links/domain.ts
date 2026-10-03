/**
 * Pure rules for the item cross-reference (no I/O): exact code/sku auto-suggestion and
 * the merged "one item" view used by the picker. Kept dependency-free so both the routes
 * and the tests exercise the same functions.
 */

export type InvItem = { id: string; name: string; sku: string | null };
export type StockItem = { id: string; code: string; name: string };
export type LinkRef = { id: string; inventoryItemId: string; stockItemId: string; stockItemCode: string; stockItemName: string };

/** Codes are compared trimmed and case-insensitively; blank codes never match anything. */
export function normalizeCode(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

export type Suggestion = {
  inventoryItemId: string;
  inventoryName: string;
  sku: string;
  stockItemId: string;
  stockName: string;
  stockCode: string;
};

/**
 * Exact sku/code matches between items that are not linked yet. Only an UNAMBIGUOUS 1:1
 * match is suggested: if two inventory items share a sku, or two stock items share a code,
 * nothing is suggested for that code (an admin must link those by hand) and it is counted
 * in `ambiguous` so the report can say so.
 */
export function suggestLinks(
  inventory: InvItem[],
  stock: StockItem[],
  links: Pick<LinkRef, "inventoryItemId" | "stockItemId">[],
): { suggestions: Suggestion[]; ambiguous: number } {
  const linkedInv = new Set(links.map((l) => l.inventoryItemId));
  const linkedStock = new Set(links.map((l) => l.stockItemId));
  const invByCode = new Map<string, InvItem[]>();
  for (const i of inventory) {
    const k = normalizeCode(i.sku);
    if (!k || linkedInv.has(i.id)) continue;
    invByCode.set(k, [...(invByCode.get(k) ?? []), i]);
  }
  const stockByCode = new Map<string, StockItem[]>();
  for (const s of stock) {
    const k = normalizeCode(s.code);
    if (!k || linkedStock.has(s.id)) continue;
    stockByCode.set(k, [...(stockByCode.get(k) ?? []), s]);
  }
  const suggestions: Suggestion[] = [];
  let ambiguous = 0;
  for (const [code, invs] of invByCode) {
    const stocks = stockByCode.get(code);
    if (!stocks) continue;
    const inv = invs[0];
    const stk = stocks[0];
    if (invs.length !== 1 || stocks.length !== 1 || !inv || !stk) { ambiguous += 1; continue; }
    suggestions.push({
      inventoryItemId: inv.id, inventoryName: inv.name, sku: (inv.sku ?? "").trim(),
      stockItemId: stk.id, stockName: stk.name, stockCode: stk.code,
    });
  }
  suggestions.sort((a, b) => a.sku.localeCompare(b.sku) || a.inventoryItemId.localeCompare(b.inventoryItemId));
  return { suggestions, ambiguous };
}

export type PickerEntry = {
  /** Stable key: the inventory id for linked / inventory-only items, the stock id for stock-only. */
  key: string;
  kind: "linked" | "inventory_only" | "stock_only";
  inventoryItemId: string | null;
  stockItemId: string | null;
  /** Display code: the inventory sku when there is one, else the stock item code. */
  code: string;
  name: string;
  /** Code on the stock side, when the item has one. */
  stockCode: string | null;
};

/**
 * Merges both masters into ONE list: a linked pair is a single entry (never two rows),
 * unlinked items stay visible and are labelled by their `kind`.
 * `invById` supplies the inventory side for a stock hit whose partner did not itself match
 * the search text; the link row carries the stock side for an inventory hit.
 */
export function mergePicker(
  invHits: InvItem[],
  stockHits: StockItem[],
  links: LinkRef[],
  invById: Map<string, InvItem>,
): PickerEntry[] {
  const byInv = new Map(links.map((l) => [l.inventoryItemId, l]));
  const byStock = new Map(links.map((l) => [l.stockItemId, l]));
  const out = new Map<string, PickerEntry>();

  const linkedEntry = (link: LinkRef, inv: InvItem): PickerEntry => ({
    key: inv.id, kind: "linked", inventoryItemId: inv.id, stockItemId: link.stockItemId,
    code: (inv.sku ?? "").trim() || link.stockItemCode, name: inv.name, stockCode: link.stockItemCode,
  });

  for (const inv of invHits) {
    const link = byInv.get(inv.id);
    out.set(inv.id, link
      ? linkedEntry(link, inv)
      : { key: inv.id, kind: "inventory_only", inventoryItemId: inv.id, stockItemId: null, code: (inv.sku ?? "").trim() || "-", name: inv.name, stockCode: null });
  }
  for (const s of stockHits) {
    const link = byStock.get(s.id);
    if (link) {
      if (out.has(link.inventoryItemId)) continue;
      const inv = invById.get(link.inventoryItemId);
      if (inv) out.set(inv.id, linkedEntry(link, inv));
      continue;
    }
    out.set(s.id, { key: s.id, kind: "stock_only", inventoryItemId: null, stockItemId: s.id, code: s.code, name: s.name, stockCode: s.code });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}
