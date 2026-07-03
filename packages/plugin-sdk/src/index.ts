/**
 * @civitasone/plugin-sdk
 *
 * Foundation package for the CivitasOne plugin system.
 * Provides manifest validation, runtime types, lifecycle management, and permissions.
 */

export {
  pluginManifestSchema,
  validateManifest,
  VALID_PERMISSIONS,
  type PluginManifest,
  type ValidPermission,
} from "./manifest.js";

export {
  type PluginContext,
  type PluginStore,
  type PluginAuthContext,
  type PluginLogger,
  type PluginPlatform,
  type EventEnvelope,
  type PluginRequest,
  type PluginResponse,
  type PluginEventHandler,
  type PluginScheduleHandler,
  type PluginRouteHandler,
} from "./runtime.js";

export {
  PluginState,
  validTransitions,
  transitionPlugin,
  type PluginAction,
  type PluginTransition,
} from "./lifecycle.js";

export {
  parsePermission,
  checkPermission,
  PERMISSION_CATALOG,
  type ParsedPermission,
  type PermissionCheckResult,
} from "./permissions.js";
