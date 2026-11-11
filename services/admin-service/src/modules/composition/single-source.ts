/**
 * M4 single source of truth: with MODULE_SOURCE=catalogue the module catalogue (composition entitlements resolved
 * against composition.module_registry) is the ONLY answer to "which modules does this tenant have". The older
 * switch list (config.admin_module_configs) is then derived from it on read and its write path is retired.
 *
 * Default (unset) = today's behaviour, byte for byte: this module is not consulted.
 * A tenant that has never been composed (no profile, no entitlements) still falls back to its legacy rows, so
 * switching the flag on can never blank a tenant that predates composition (migration 0059 carries those over).
 */
import { legacyKeysFromModules, MODULE_CATALOGUE } from "@civitasone/schemas/module-catalogue";
import { buildRegistry, resolveComposition } from "./domain.js";
import * as repo from "./repo.js";

export function catalogueIsSource(): boolean {
  return process.env.MODULE_SOURCE === "catalogue";
}

/** Resolved catalogue module ids for a composed tenant, or null when the tenant was never composed. */
export async function resolvedCatalogueModules(tenantId: string): Promise<string[] | null> {
  const [profileCode, selected] = await Promise.all([repo.getTenantProfileCode(tenantId), repo.getEffectiveSelectedModules(tenantId)]);
  if (profileCode === null && selected.length === 0) return null;
  const reg = buildRegistry(await repo.loadRegistry(tenantId));
  return resolveComposition(reg, selected).moduleIds;
}

/** The older switch list, derived from the catalogue (null = not composed, caller falls back to legacy rows). */
export async function legacyKeysFromCatalogue(tenantId: string): Promise<string[] | null> {
  const ids = await resolvedCatalogueModules(tenantId);
  return ids === null ? null : legacyKeysFromModules(ids);
}

/** Settings-page rows derived from the catalogue: every sellable module, enabled when the tenant resolves it. */
export async function catalogueModuleRows(tenantId: string): Promise<Array<{ name: string; moduleKey: string; moduleName: string; enabled: boolean }> | null> {
  const ids = await resolvedCatalogueModules(tenantId);
  if (ids === null) return null;
  const on = new Set(ids);
  return MODULE_CATALOGUE.filter((m) => !m.isCore).map((m) => ({ name: m.id, moduleKey: m.id, moduleName: m.name, enabled: on.has(m.id) }));
}
