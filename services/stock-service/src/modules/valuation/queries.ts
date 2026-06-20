import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { ValuationRateRow } from "./schema.js";

export async function getValuationRate(tenantId: string, itemId: string, warehouseId: string): Promise<ValuationRateRow | null> {
  return cache.getOrLoad(
    cache.makeKey(tenantId, "valuation", `${itemId}:${warehouseId}`),
    () => repo.findValuationRate(tenantId, itemId, warehouseId)
  );
}
