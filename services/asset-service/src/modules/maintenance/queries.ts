import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

export async function listMaintenanceByAsset(tenantId: string, assetId: string) {
  return repo.listMaintenanceByAsset(tenantId, assetId);
}

export async function listMaintenance(tenantId: string, limit: number, offset: number) {
  const key = cache.listKey(tenantId, "maintenance", `list:${limit}:${offset}`);
  return (await cache.getOrLoad(key, () => repo.listMaintenanceByTenant(tenantId, { limit, offset }))) ?? [];
}

export async function listMaintenancePlans(tenantId: string, opts?: { assetId?: string }) {
  return repo.listMaintenancePlans(tenantId, opts);
}
