import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { AssetRow } from "./schema.js";

/** If bookValue was never set (zero) but acquisitionCost exists, compute it from acquisitionCost - accumulatedDep. */
function hydrateBookValue(row: AssetRow): AssetRow {
  const bv = BigInt(row.bookValue as unknown as string | bigint);
  const cost = BigInt(row.acquisitionCost as unknown as string | bigint);
  if (bv === 0n && cost > 0n) {
    const accDep = BigInt((row.accumulatedDep ?? 0n) as unknown as string | bigint);
    const computed = cost - accDep;
    return { ...row, bookValue: computed > 0n ? computed : 0n };
  }
  return row;
}

export async function getAsset(tenantId: string, id: string): Promise<AssetRow | null> {
  const row = await cache.getOrLoad(
    cache.makeKey(tenantId, "asset", id),
    () => repo.findAssetById(id)
  );
  return row ? hydrateBookValue(row) : null;
}

export async function listAssets(tenantId: string, opts?: { category?: string; status?: string; type?: string; limit?: number; offset?: number }): Promise<AssetRow[]> {
  const key = cache.listKey(tenantId, "asset", JSON.stringify(opts ?? {}));
  const rows = (await cache.getOrLoad(key, () => repo.findAssetsByTenant(tenantId, opts))) ?? [];
  return rows.map(hydrateBookValue);
}
