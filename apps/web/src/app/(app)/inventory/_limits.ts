/**
 * Page sizes the inventory registers request. The inventory-service caps
 * items/bins/goods-returns at 200 rows per page and the ledger at 500; a
 * response that fills its page is reported to the user ("showing the first N")
 * instead of being presented as the complete register (GAP-INVENTORY-*-04).
 * Kept out of _data.ts so client tables can import it without pulling the
 * server-only loaders into the browser bundle.
 */
export const INVENTORY_LIST_LIMIT = 200;
export const INVENTORY_LEDGER_LIMIT = 500;
/** stock-service ledger page ceiling (its ledgerQueryParams max); its default is only 100 (GAP-INVENTORY-RECONCILE-05). */
export const STOCK_LEDGER_LIMIT = 500;

/** Plain-language note for a register whose page is full, or null when it is not. */
export function capNote(count: number, limit: number, noun: string): string | null {
  return count >= limit
    ? `Showing the first ${limit} ${noun}. There may be more records than are listed here.`
    : null;
}
