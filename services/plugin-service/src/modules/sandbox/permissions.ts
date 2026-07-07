/**
 * Plugin Manifest-Based Permission Enforcement
 *
 * Pure domain logic for checking whether a plugin has been granted
 * a specific permission via its manifest declaration. The plugin sandbox
 * runtime uses this to gate every host operation (DB reads/writes, event
 * emission, outbound HTTP, storage access).
 *
 * Fixed permission set:
 *   - read:tenant    → DB read operations scoped to the tenant
 *   - write:tenant   → DB write operations scoped to the tenant
 *   - emit:event     → Emit platform domain events
 *   - http:outbound  → Make outbound HTTP calls
 *   - storage:read   → Read from tenant object storage
 *   - storage:write  → Write to tenant object storage
 */

import type { PluginManifest, PluginPermission } from "./types.js";

/**
 * Maps high-level operations to the permission required to perform them.
 * Keys are canonical operation identifiers used by the sandbox runtime.
 */
export const OPERATION_PERMISSION_MAP: Record<string, PluginPermission> = {
  "db:read": "read:tenant",
  "db:write": "write:tenant",
  "event:emit": "emit:event",
  "http:outbound": "http:outbound",
  "storage:read": "storage:read",
  "storage:write": "storage:write",
} as const;

/** All valid permissions that a plugin can declare */
export const VALID_PERMISSIONS: readonly PluginPermission[] = [
  "read:tenant",
  "write:tenant",
  "emit:event",
  "http:outbound",
  "storage:read",
  "storage:write",
] as const;

/** Error structure returned when a permission check fails */
export interface PermissionDeniedError {
  code: "permission_denied";
  message: string;
}

/**
 * Check whether a plugin's manifest grants the permission required
 * for the given operation.
 *
 * @param manifest - The plugin manifest declaring granted permissions
 * @param operation - The canonical operation identifier (e.g., "db:read", "event:emit")
 * @returns true if the operation is permitted, false otherwise
 */
export function checkPermission(manifest: PluginManifest, operation: string): boolean {
  const requiredPermission = OPERATION_PERMISSION_MAP[operation];

  // If the operation is not mapped, deny by default (fail-closed)
  if (!requiredPermission) {
    return false;
  }

  // Check if the manifest includes the required permission
  if (!manifest.permissions || !Array.isArray(manifest.permissions)) {
    return false;
  }

  return manifest.permissions.includes(requiredPermission);
}

/**
 * Enforce a permission check and return a structured error when denied.
 * Use this in the sandbox runtime to reject unauthorized operations.
 *
 * @param manifest - The plugin manifest declaring granted permissions
 * @param operation - The canonical operation identifier
 * @returns null if permitted, PermissionDeniedError if denied
 */
export function enforcePermission(
  manifest: PluginManifest,
  operation: string,
): PermissionDeniedError | null {
  if (checkPermission(manifest, operation)) {
    return null;
  }

  const requiredPermission = OPERATION_PERMISSION_MAP[operation] ?? operation;

  return {
    code: "permission_denied",
    message: `Plugin does not have permission: ${requiredPermission}`,
  };
}

/**
 * Validate that a manifest's declared permissions are all from the fixed set.
 * Returns an array of invalid permissions (empty array means all valid).
 *
 * @param manifest - The plugin manifest to validate
 * @returns Array of invalid permission strings (empty if all valid)
 */
export function validateManifestPermissions(manifest: PluginManifest): string[] {
  if (!manifest.permissions || !Array.isArray(manifest.permissions)) {
    return [];
  }

  const validSet = new Set<string>(VALID_PERMISSIONS);
  return manifest.permissions.filter((p) => !validSet.has(p));
}
