/** Gateway-native command / event topics (catalogue module). */
export const COMMANDS = {
  registerApi: "gateway.catalogue.register",
  lifecycleApi: "gateway.catalogue.lifecycle",
  seedCatalogue: "gateway.catalogue.seed",
} as const;

export const EVENTS = {
  apiRegistered: "gateway.catalogue.registered",
  apiLifecycleChanged: "gateway.catalogue.lifecycle_changed",
  catalogueSeeded: "gateway.catalogue.seeded",
} as const;

/**
 * Admin-owned events the gateway-worker consumes (module-cache-invalidation.ts):
 * the post-commit enforcement-mode event drops the module-guard cache in the app.
 */
export const CONSUMED_EVENTS = {
  compositionEnforcementModeChanged: "admin.composition.enforcement_mode_changed",
} as const;

export const SERVICE = "gateway";
export const RESOURCE = "catalogue";
