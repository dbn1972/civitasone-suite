/**
 * Page sizes the inventory registers request. The inventory-service caps
 * items/bins/goods-returns at 200 rows per page and the ledger at 500; a
 * response that fills its page is reported to the user ("showing the first N")
 * instead of being presented as the complete register (GAP-INVENTORY-*-04).
 * Kept out of _data.ts so client tables can import it without pulling the
 * server-only loaders into the browser bundle.
 */
export const INVENTORY_LIST_LIMIT = 200;
/** inventory-service low-stock page ceiling (lowStockQueryParams max); its default is only 100. Rows come most-urgent-first, so a full page still leads with the worst shortfalls. */
export const LOW_STOCK_LIMIT = 500;
export const INVENTORY_LEDGER_LIMIT = 500;
/** stock-service ledger page ceiling (its ledgerQueryParams max); its default is only 100 (GAP-INVENTORY-RECONCILE-05). */
export const STOCK_LEDGER_LIMIT = 500;

/**
 * Q37: "Showing 500 of 1,234 ..." when the service reported an exact total larger than the page;
 * otherwise falls back to the generic cap note. Null when everything is on screen.
 */
export function totalNote(count: number, total: number | undefined, limit: number, noun: string): string | null {
  if (typeof total === "number" && total > count) {
    return `Showing ${count.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")} ${noun}.`;
  }
  return capNote(count, limit, noun);
}

/** Plain-language note for a register whose page is full, or null when it is not. */
export function capNote(count: number, limit: number, noun: string): string | null {
  return count >= limit
    ? `Showing the first ${limit} ${noun}. There may be more records than are listed here.`
    : null;
}
