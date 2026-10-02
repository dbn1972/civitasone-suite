/**
 * GAP-ASSETS-LIST-02 / GAP-ASSETS-FIXED-ASSETS-01: one pure summary for the
 * asset registers, computed from exactly the rows the table renders.
 * Amounts are minor units (paise).
 */
export type StatAsset = { status: string; purchaseCost: number; currentValue: number };

export type AssetStats = { count: number; activePct: number; grossBlock: number; netBlock: number };

export function computeAssetStats(rows: readonly StatAsset[]): AssetStats {
  const active = rows.filter((a) => a.status === "active" || a.status === "in_use").length;
  return {
    count: rows.length,
    activePct: rows.length > 0 ? Math.round((active / rows.length) * 100) : 0,
    grossBlock: rows.reduce((sum, a) => sum + a.purchaseCost, 0),
    netBlock: rows.reduce((sum, a) => sum + a.currentValue, 0),
  };
}
