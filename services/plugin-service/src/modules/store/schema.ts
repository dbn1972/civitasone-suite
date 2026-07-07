/**
 * Plugin Store Schema
 *
 * Per-tenant per-plugin key-value store with 100MB quota per plugin per tenant.
 * Stores arbitrary JSONB values with size tracking for quota enforcement.
 */

import { pgSchema, uuid, varchar, jsonb, integer, timestamp } from "drizzle-orm/pg-core";

export const storeSchema = pgSchema("store");

/**
 * plugin_stores — per-tenant per-plugin key-value store
 *
 * Each row represents a single key-value entry scoped to a tenant+plugin combination.
 * The size_bytes column tracks the serialized size of the value for quota enforcement.
 */
export const pluginStores = storeSchema.table("plugin_stores", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  pluginId: uuid("plugin_id").notNull(),
  key: varchar("key", { length: 256 }).notNull(),
  value: jsonb("value").$type<unknown>().notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type PluginStoreRow = typeof pluginStores.$inferSelect;
export type PluginStoreInsert = typeof pluginStores.$inferInsert;

/** 100 MB quota per plugin per tenant in bytes */
export const STORE_QUOTA_BYTES = 100 * 1024 * 1024;

export const schema = { pluginStores };
