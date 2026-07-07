/**
 * Plugin Event Subscription Domain Logic
 *
 * Pure domain functions for determining whether a platform domain event
 * should be delivered to a specific plugin based on its manifest declarations.
 *
 * Plugins declare which events they listen to in their manifest `events: string[]`.
 * Only events matching the manifest declaration are delivered.
 *
 * Matching rules:
 *   - Exact match: "finance.bill.passed" matches "finance.bill.passed"
 *   - Wildcard "*" matches all events
 *   - Prefix wildcard: "finance.*" matches "finance.bill.passed", "finance.payment.created"
 */

import type { PluginManifest } from "../sandbox/types.js";

/**
 * Determine whether a domain event should be delivered to a plugin
 * based on the plugin's manifest event subscriptions.
 *
 * @param manifest - The plugin manifest declaring event subscriptions
 * @param eventType - The domain event type to check (e.g., "finance.bill.passed")
 * @returns true if the event should be delivered, false otherwise
 */
export function shouldDeliverEvent(manifest: PluginManifest, eventType: string): boolean {
  // No events declared → no events delivered
  if (!manifest.events || !Array.isArray(manifest.events) || manifest.events.length === 0) {
    return false;
  }

  // Empty event type → never deliver
  if (!eventType || eventType.trim().length === 0) {
    return false;
  }

  for (const declared of manifest.events) {
    // Wildcard matches everything
    if (declared === "*") {
      return true;
    }

    // Exact match
    if (declared === eventType) {
      return true;
    }

    // Prefix wildcard: "finance.*" matches "finance.bill.passed"
    if (declared.endsWith(".*")) {
      const prefix = declared.slice(0, -2); // remove ".*"
      if (eventType.startsWith(prefix + ".")) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Filter a list of plugin manifests to find those subscribed to a given event.
 *
 * @param manifests - Array of tuples [pluginId, manifest]
 * @param eventType - The domain event type
 * @returns Array of pluginIds that should receive the event
 */
export function filterSubscribedPlugins(
  manifests: Array<[string, PluginManifest]>,
  eventType: string,
): string[] {
  return manifests
    .filter(([, manifest]) => shouldDeliverEvent(manifest, eventType))
    .map(([pluginId]) => pluginId);
}
