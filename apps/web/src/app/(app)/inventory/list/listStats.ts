import { formatMoney } from "@/lib/formatters";

type StatItem = { totalValue: number | null; isLowStock: boolean | null };

export type StockListStats = {
  total: number | null;
  lowStock: number | null;
  /** Formatted total, or null when the load failed or no item reported a value. */
  valueText: string | null;
  valueLabel: string;
};

/**
 * Stat-card values for the stock list. A failed load, or items whose level/value
 * the service did not report, never become a fabricated 0 / Rs 0: unknown rows are
 * left out of the low-stock count and the value total (which is summed in integer
 * paise), and the value label says how many items were valued.
 */
export function stockListStats(items: StatItem[], failed: boolean): StockListStats {
  const valued = items.filter((i) => i.totalValue !== null);
  const valueLabel =
    valued.length === items.length ? "Stock Value" : `Stock Value (${valued.length} of ${items.length} items valued)`;
  if (failed) return { total: null, lowStock: null, valueText: null, valueLabel };
  const paise = valued.reduce((sum, i) => sum + BigInt(Math.round(i.totalValue as number)), 0n);
  return {
    total: items.length,
    lowStock: items.filter((i) => i.isLowStock === true).length,
    valueText: valued.length > 0 ? formatMoney(paise) : null,
    valueLabel,
  };
}
