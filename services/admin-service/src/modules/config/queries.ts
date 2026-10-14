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

function humanizeModuleKey(key: string): string {
  return key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * GAP-TENANT-ADMIN-SETTINGS-01: detailed module list for the Settings page —
 * all of the tenant's module rows with their real enabled flag. `name` is kept
 * so the legacy {name}-only readers of the same endpoint keep parsing.
 */
export async function listTenantModulesDetailed(tenantId: string): Promise<Array<{ name: string; moduleKey: string; moduleName: string; enabled: boolean; enabledAt?: string }>> {
  const rows = await repo.listModuleConfigs(tenantId);
  return rows.map((r) => ({
    name: r.moduleKey,
    moduleKey: r.moduleKey,
    moduleName: humanizeModuleKey(r.moduleKey),
    enabled: r.enabled,
    ...(r.enabled && r.updatedAt ? { enabledAt: r.updatedAt.toISOString() } : {}),
  }));
}

export function isTenantModuleConfigured(tenantId: string, moduleKey: string): Promise<boolean> {
  return repo.moduleConfigured(tenantId, moduleKey);
}
