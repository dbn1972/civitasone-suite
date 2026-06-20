import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

export async function getConfig(tenantId: string) {
  return cache.getOrLoad(cache.makeKey(tenantId, "config", tenantId), () => repo.getTenantConfig(tenantId));
}

export async function listFeatureFlags() {
  return cache.getOrLoad("admin:platform:feature_flags", () => repo.listFlags());
}

export async function listTenantModules(tenantId: string): Promise<Array<{ name: string }>> {
  const keys = await repo.listModuleKeys(tenantId);
  return keys.map((name) => ({ name }));
}
