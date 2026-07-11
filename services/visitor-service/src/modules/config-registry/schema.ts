/**
 * config-registry — Drizzle table definitions.
 *
 * This table lives in the `visitor` PostgreSQL schema and mirrors, column-for-
 * column, the DDL created by migrations/0010_visitor_config.sql.
 *
 * Scope: config_entries — the config/metadata keystone. A tenant-scoped,
 * versioned, namespaced key/value store: (namespace, config_key) → jsonb value.
 * Other modules READ this table (via repo.getConfigValueOnTx / listActiveKeys)
 * to drive behavior from tenant configuration instead of hardcoded knobs.
 *
 * Standard mutable-entity columns: id (uuid PK), tenant_id, created_at, updated_at,
 * created_by, updated_by, version — so shared/outbox.ts#versionedUpdate applies.
 */
import { pgSchema, uuid, text, integer, date, varchar, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

/** The `visitor` PG schema — every visitor-service table is namespaced under it. */
export const visitorSchema = pgSchema("visitor");

// ─── Config entries (config/metadata keystone) ──────────────────────────────────

export const configEntries = visitorSchema.table("config_entries", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  namespace:     varchar("namespace", { length: 64 }).notNull(),
  configKey:     varchar("config_key", { length: 128 }).notNull(),
  value:         jsonb("value").notNull().$type<unknown>(),
  label:         text("label"),
  description:   text("description"),
  active:        boolean("active").notNull().default(true),
  sortOrder:     integer("sort_order").notNull().default(0),
  effectiveFrom: date("effective_from"),
  effectiveTo:   date("effective_to"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by"),
  updatedBy:     uuid("updated_by"),
  version:       integer("version").notNull().default(1),
});

// ─── Inferred row/insert types ─────────────────────────────────────────────────

export type ConfigEntryRow    = typeof configEntries.$inferSelect;
export type ConfigEntryInsert = typeof configEntries.$inferInsert;

/** Merged export consumed by shared/db.ts to assemble the full Drizzle schema. */
export const schema = {
  configEntries,
};
