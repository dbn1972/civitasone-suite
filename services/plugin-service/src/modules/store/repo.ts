/**
 * Plugin Store Repository
 *
 * Database access layer for the per-tenant per-plugin key-value store.
 * Uses cache.getOrLoad pattern for reads.
 */

import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { pluginStores } from "./schema.js";

/**
 * Get a single key-value entry for a plugin within a tenant.
 */
export async function getEntry(
  tenantId: string,
  pluginId: string,
  key: string,
) {
  const cacheKey = cache.makeKey(tenantId, "plugin-store", `${pluginId}:${key}`);
  return cache.getOrLoad(cacheKey, async () => {
    const rows = await db
      .select()
      .from(pluginStores)
      .where(
        and(
          eq(pluginStores.tenantId, tenantId),
          eq(pluginStores.pluginId, pluginId),
          eq(pluginStores.key, key),
        ),
      );
    return rows[0] ?? null;
  });
}

/**
 * Get current total usage in bytes for a plugin within a tenant.
 */
export async function getTotalUsageBytes(
  tenantId: string,
  pluginId: string,
): Promise<number> {
  const result = await db
    .select({ total: sql<number>`COALESCE(SUM(${pluginStores.sizeBytes}), 0)` })
    .from(pluginStores)
    .where(
      and(
        eq(pluginStores.tenantId, tenantId),
        eq(pluginStores.pluginId, pluginId),
      ),
    );
  return Number(result[0]?.total ?? 0);
}

/**
 * Upsert a key-value entry (insert or update).
 */
export async function upsertEntry(
  tenantId: string,
  pluginId: string,
  key: string,
  value: unknown,
  sizeBytes: number,
  actorId: string,
) {
  // Check if key already exists
  const existing = await db
    .select({ id: pluginStores.id })
    .from(pluginStores)
    .where(
      and(
        eq(pluginStores.tenantId, tenantId),
        eq(pluginStores.pluginId, pluginId),
        eq(pluginStores.key, key),
      ),
    );

  if (existing.length > 0) {
    // Update existing entry
    await db
      .update(pluginStores)
      .set({
        value,
        sizeBytes,
        updatedAt: new Date(),
        updatedBy: actorId,
        version: sql`${pluginStores.version} + 1`,
      })
      .where(eq(pluginStores.id, existing[0]!.id));
  } else {
    // Insert new entry
    await db.insert(pluginStores).values({
      tenantId,
      pluginId,
      key,
      value,
      sizeBytes,
      createdBy: actorId,
      updatedBy: actorId,
    });
  }

  // Invalidate cache
  const cacheKey = cache.makeKey(tenantId, "plugin-store", `${pluginId}:${key}`);
  await cache.invalidate(cacheKey);
}

/**
 * Delete a key-value entry.
 * Returns true if a row was actually deleted.
 */
export async function deleteEntry(
  tenantId: string,
  pluginId: string,
  key: string,
): Promise<boolean> {
  const result = await db
    .delete(pluginStores)
    .where(
      and(
        eq(pluginStores.tenantId, tenantId),
        eq(pluginStores.pluginId, pluginId),
        eq(pluginStores.key, key),
      ),
    );

  // Invalidate cache
  const cacheKey = cache.makeKey(tenantId, "plugin-store", `${pluginId}:${key}`);
  await cache.invalidate(cacheKey);

  // drizzle returns the affected rows count via the underlying driver
  return (result as unknown as { rowCount: number }).rowCount > 0;
}
