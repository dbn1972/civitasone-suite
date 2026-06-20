import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { DepScheduleRow, DepEntryRow } from "./schema.js";

export async function getDepSchedule(tenantId: string, assetId: string): Promise<DepScheduleRow | null> {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "dep_schedule", assetId),
    () => repo.findScheduleByAsset(assetId, tenantId)
  );
}

export async function getDepEntries(tenantId: string, assetId: string): Promise<DepEntryRow[]> {
  const key = cache.listKey(tenantId, "dep_entry", assetId);
  return (await cache.getOrLoad(key, () => repo.findEntriesByAsset(assetId, tenantId))) ?? [];
}
