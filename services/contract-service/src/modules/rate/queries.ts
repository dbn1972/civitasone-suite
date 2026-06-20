import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { RcRow } from "./schema.js";

export async function getRateContract(id: string, tenantId: string): Promise<RcRow | null> {
  return cache.getOrLoad<RcRow>(
    cache.makeKey(tenantId, "rc", id),
    () => repo.findRcById(id)
  );
}

export async function listRateContractsByItem(tenantId: string, itemCode: string): Promise<RcRow[]> {
  const result = await cache.getOrLoad<RcRow[]>(
    cache.makeKey(tenantId, "rc", `item:${itemCode}`),
    () => repo.findRcsByItem(tenantId, itemCode)
  );
  return result ?? [];
}
