import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { AssetRow } from "./schema.js";

export async function getAsset(tenantId: string, id: string): Promise<AssetRow | null> {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "asset", id),
    () => repo.findAssetById(id)
  );
}

export async function listAssets(tenantId: string, opts?: { category?: string; status?: string; type?: string; limit?: number; offset?: number }): Promise<AssetRow[]> {
  const key = cache.listKey(tenantId, "asset", JSON.stringify(opts ?? {}));
  return (await cache.getOrLoad(key, () => repo.findAssetsByTenant(tenantId, opts))) ?? [];
}
