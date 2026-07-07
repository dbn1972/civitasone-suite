/**
 * Plugin Preview Flag & Feature Gate
 *
 * Plugins can be marked as "preview" in their manifest. Preview plugins are
 * gated behind the environment variable:
 *   FEATURE_PLUGIN_PREVIEW_ENABLED=true
 *
 * When the feature gate is disabled, preview plugins cannot be activated,
 * their event handlers are not invoked, and their store is inaccessible.
 *
 * Requirements: 16.6, 16.7
 */

import type { PluginManifest } from "../sandbox/types.js";

/**
 * Check whether plugin preview mode is enabled globally.
 * Reads FEATURE_PLUGIN_PREVIEW_ENABLED environment variable.
 */
export function isPreviewEnabled(): boolean {
  return process.env.FEATURE_PLUGIN_PREVIEW_ENABLED === "true";
}

/**
 * Check whether a plugin manifest declares the plugin as a preview plugin.
 */
export function isPreviewPlugin(manifest: PluginManifest): boolean {
  return (manifest as unknown as Record<string, unknown>)["preview"] === true;
}

/**
 * Determine whether a plugin should be activated (event delivery, store access, etc.)
 * based on its preview status and the global feature gate.
 *
 * Rules:
 *   - Non-preview plugins: always allowed (returns true)
 *   - Preview plugins: allowed only when FEATURE_PLUGIN_PREVIEW_ENABLED=true
 *
 * @param manifest - The plugin manifest
 * @returns true if the plugin is allowed to be active
 */
export function isPluginAllowed(manifest: PluginManifest): boolean {
  if (!isPreviewPlugin(manifest)) {
    return true;
  }
  return isPreviewEnabled();
}
