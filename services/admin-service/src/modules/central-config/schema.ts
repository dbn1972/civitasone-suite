/**
 * CAP-091 Central Config Management — Drizzle schema.
 *
 * Lives in its OWN Postgres schema `central_config` (L2 rule: this module's
 * repo queries ONLY `central_config.*`).
 *
 * Three tables give the four CAP-091 properties:
 *   - config_entries          → the live, approved value of each key (versioned).
 *   - config_versions         → immutable history of every approved value.
 *   - config_change_requests  → maker-checker workflow (propose → approve/reject).
 *
 * Sensitive values are stored ENCRYPTED (AES-256-GCM, see domain.ts). The
 * `encrypted` flag records whether the persisted `value` is ciphertext.
 */
import { pgSchema, uuid, text, boolean, integer, jsonb, timestamp, varchar, uniqueIndex } from "drizzle-orm/pg-core";

export const centralConfigSchema = pgSchema("central_config");

/** The current, approved value for a config key (one row per tenant+key). */
export const configEntries = centralConfigSchema.table("config_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  key: varchar("key", { length: 160 }).notNull(),
  // The live value. When `sensitive` is true this holds ciphertext (see domain).
  value: jsonb("value").notNull(),
  sensitive: boolean("sensitive").notNull().default(false),
  encrypted: boolean("encrypted").notNull().default(false),
  description: text("description").notNull().default(""),
  owner: varchar("owner", { length: 160 }).notNull().default(""),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
}, (t) => ({
  keyUnique: uniqueIndex("central_config_entries_tenant_key_key").on(t.tenantId, t.key),
}));

/** Immutable append-only history: one row per approved value of a key. */
export const configVersions = centralConfigSchema.table("config_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  entryId: uuid("entry_id").notNull(),
  key: varchar("key", { length: 160 }).notNull(),
  version: integer("version").notNull(),
  value: jsonb("value").notNull(),
  sensitive: boolean("sensitive").notNull().default(false),
  encrypted: boolean("encrypted").notNull().default(false),
  note: text("note"),
  approvedBy: uuid("approved_by").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  versionUnique: uniqueIndex("central_config_versions_tenant_key_version_key").on(t.tenantId, t.key, t.version),
}));

/** Maker-checker change request against a config key. */
export const configChangeRequests = centralConfigSchema.table("config_change_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  key: varchar("key", { length: 160 }).notNull(),
  // Proposed new value; ciphertext when `sensitive`.
  proposedValue: jsonb("proposed_value").notNull(),
  sensitive: boolean("sensitive").notNull().default(false),
  encrypted: boolean("encrypted").notNull().default(false),
  description: text("description").notNull().default(""),
  owner: varchar("owner", { length: 160 }).notNull().default(""),
  note: text("note"),
  // pending | approved | rejected
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  proposedBy: uuid("proposed_by").notNull(),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedReason: text("rejected_reason"),
  // The entry version this change was based on (optimistic concurrency hint).
  baseVersion: integer("base_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ConfigEntryRow = typeof configEntries.$inferSelect;
export type ConfigEntryInsert = typeof configEntries.$inferInsert;
export type ConfigVersionRow = typeof configVersions.$inferSelect;
export type ConfigVersionInsert = typeof configVersions.$inferInsert;
export type ConfigChangeRow = typeof configChangeRequests.$inferSelect;
export type ConfigChangeInsert = typeof configChangeRequests.$inferInsert;

export const schema = { configEntries, configVersions, configChangeRequests };
