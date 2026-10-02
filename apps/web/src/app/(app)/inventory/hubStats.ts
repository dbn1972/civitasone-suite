/**
 * Pure helpers for the inventory hub (GAP-INVENTORY-HOME-02 / -03).
 */
import type { InventoryLowStockRow } from "./_data";

/**
 * on-hand / reorder-level. A low-stock row is at or below its reorder level, so
 * "nearest reorder" in practice means "furthest below it": the smallest ratio.
 * A reorder level of 0 has no meaningful ratio and sorts last (it cannot be
 * "below" anything), so it never divides by zero or wins by accident.
 */
function coverRatio(r: Pick<InventoryLowStockRow, "onHandQty" | "reorderLevel">): number {
  return r.reorderLevel > 0 ? r.onHandQty / r.reorderLevel : Number.POSITIVE_INFINITY;
}

/**
 * The low-stock row furthest below its reorder level, whatever order the API
 * returned. Ties break on the larger absolute shortfall, then on name so the
 * choice is stable between renders.
 */
export function pickMostBelowReorder(rows: InventoryLowStockRow[]): InventoryLowStockRow | undefined {
  let best: InventoryLowStockRow | undefined;
  for (const r of rows) {
    if (!best) {
      best = r;
      continue;
    }
    const a = coverRatio(r);
    const b = coverRatio(best);
    if (a < b) best = r;
    else if (a === b) {
      const shortA = r.reorderLevel - r.onHandQty;
      const shortB = best.reorderLevel - best.onHandQty;
      if (shortA > shortB || (shortA === shortB && r.name.localeCompare(best.name) < 0)) best = r;
    }
  }
  return best;
}

export type TileBadge = { text: string; tone?: "warn" | "info" };

/** A count badge: "—" when the count could not be loaded (never a fabricated 0). */
export function countBadge(count: number | null, label: string, capped = false): TileBadge {
  if (count === null) return { text: "—", tone: "info" };
  // When the fetched page was full the count is a lower bound ("200+"), not exact.
  const shown = capped ? `${count}+` : String(count);
  return { text: `${shown} ${label}`, tone: count > 0 ? "warn" : "info" };
}
