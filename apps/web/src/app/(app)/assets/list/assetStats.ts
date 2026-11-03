/**
 * GAP-ASSETS-LIST-02 / GAP-ASSETS-FIXED-ASSETS-01: one pure summary for the
 * asset registers, computed from exactly the rows the table renders.
 * Amounts are minor units (paise).
 */
export type StatAsset = { status: string; purchaseCost: number; currentValue: number };

export type AssetStats = { count: number; activePct: number; grossBlock: number; netBlock: number };

/**
 * Statuses that have left the books. UAT Phase 1B (recon D17): a disposed asset keeps a
 * non-zero book_value row in asset-service, so summing every row overstated Net Book Value
 * (the register read ₹7,24,700.18 against the dashboard's ₹6,85,366.82). Net Book Value is
 * the book value of assets still held -- the asset dashboard's own definition (asset-service
 * dashboard/queries.ts: status NOT IN ('disposed', 'written_off')). Condemned assets stay on
 * the books until the auction's disposal journal derecognises them, so they are included.
 */
export const DERECOGNISED_STATUSES: ReadonlySet<string> = new Set(["disposed", "written_off"]);

export function computeAssetStats(rows: readonly StatAsset[]): AssetStats {
  const active = rows.filter((a) => a.status === "active" || a.status === "in_use").length;
  return {
    count: rows.length,
    activePct: rows.length > 0 ? Math.round((active / rows.length) * 100) : 0,
    grossBlock: rows.reduce((sum, a) => sum + a.purchaseCost, 0),
    netBlock: rows.reduce((sum, a) => (DERECOGNISED_STATUSES.has(a.status) ? sum : sum + a.currentValue), 0),
  };
}
