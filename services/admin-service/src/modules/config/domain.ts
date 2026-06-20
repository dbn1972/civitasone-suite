/** Feature flag resolution: global → edition → per-tenant override. */
export type FlagLayers = {
  globalEnabled: boolean;
  editionEnabled?: boolean;
  tenantOverride?: boolean;
};

export function resolveFeatureFlag(layers: FlagLayers): boolean {
  if (layers.tenantOverride !== undefined) return layers.tenantOverride;
  if (layers.editionEnabled !== undefined) return layers.editionEnabled;
  return layers.globalEnabled;
}

export function assertModuleEnabled(enabled: boolean, moduleKey: string): void {
  if (!enabled) {
    throw new DomainError("MODULE_DISABLED", `module ${moduleKey} is disabled for this tenant`);
  }
}

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export type TenantConfigView = {
  tenantId: string;
  edition: string;
  modules: Record<string, boolean>;
  featureFlags: Record<string, boolean>;
};
