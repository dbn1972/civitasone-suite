/**
 * Plugin Store Domain Logic
 *
 * Pure domain functions for quota enforcement on the per-tenant per-plugin
 * key-value store. Each plugin per tenant has a 100MB storage quota.
 */

import { STORE_QUOTA_BYTES } from "./schema.js";

/**
 * Compute the serialized size in bytes of a JSON value.
 * Uses JSON.stringify and counts UTF-8 bytes via Buffer.
 */
export function computeValueSize(value: unknown): number {
  const serialized = JSON.stringify(value);
  return Buffer.byteLength(serialized, "utf8");
}

/**
 * Check whether writing a value of the given size would exceed the quota.
 *
 * @param currentUsageBytes - Current total bytes used by the plugin for this tenant
 * @param existingKeyBytes - Bytes of the existing value for this key (0 if new key)
 * @param newValueBytes - Bytes of the new value to be written
 * @returns true if the write would exceed the quota
 */
export function wouldExceedQuota(
  currentUsageBytes: number,
  existingKeyBytes: number,
  newValueBytes: number,
): boolean {
  // Net change: remove old value, add new value
  const projectedUsage = currentUsageBytes - existingKeyBytes + newValueBytes;
  return projectedUsage > STORE_QUOTA_BYTES;
}

/**
 * Get the quota limit in bytes.
 */
export function getQuotaBytes(): number {
  return STORE_QUOTA_BYTES;
}

/**
 * Compute remaining bytes available for a plugin.
 *
 * @param currentUsageBytes - Current total bytes used
 * @returns Remaining bytes available
 */
export function remainingQuotaBytes(currentUsageBytes: number): number {
  return Math.max(0, STORE_QUOTA_BYTES - currentUsageBytes);
}
