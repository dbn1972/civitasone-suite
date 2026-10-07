// Server-safe (no "use client"): server pages (plugins/installed, ...) call lifecycleOf().
// It lived in PluginActions.tsx, a client module, so a server-side import resolved to a client
// reference and calling it threw "TypeError: u is not a function" -- /plugins/installed
// rendered only its error boundary.

/**
 * GAP-PLUGINS-INSTALLED-01 (theme LOGIC): a plugin's lifecycle state decides
 * which single primary action is offered. "available"/"not_installed" offers
 * Install; "disabled" offers Enable; "enabled"/"active" offers Disable. No row
 * ever shows more than one primary action, and Install is never offered on an
 * already-enabled plugin (which would silently re-provision it with tenant-data
 * access).
 */
function normalize(status: string): string {
  return status.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export type PluginLifecycle = "available" | "enabled" | "disabled" | "other";

export function lifecycleOf(status: string): PluginLifecycle {
  switch (normalize(status)) {
    case "available":
    case "not_installed":
    case "uninstalled":
    case "uploaded":
      return "available";
    case "enabled":
    case "active":
      return "enabled";
    case "disabled":
      return "disabled";
    default:
      return "other";
  }
}
