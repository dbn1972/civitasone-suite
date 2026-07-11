/**
 * config-registry — Drizzle table definitions.
 *
 * This table lives in the `meeting` PostgreSQL schema and mirrors, column-for-
 * column, the DDL created by migrations/0006_meeting_config.sql.
 *
 * Scope: config_entries — the config/metadata keystone. A tenant-scoped,
 * versioned, namespaced key/value store: (namespace, config_key) → jsonb value.
 * Other modules READ this table (via repo.getConfigValueOnTx / listActiveKeys /
 * loadNamespaceOverrides) to drive behavior from tenant configuration instead of
 * hardcoded knobs.
 *
 * Standard mutable-entity columns: id (uuid PK), tenant_id, created_at, updated_at,
 * created_by, updated_by, version — so shared/outbox.ts#versionedUpdate applies.
 */
import { pgSchema, uuid, text, integer, date, varchar, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

/** The `meeting` PG schema — every meeting-service table is namespaced under it. */
export const meetingSchema = pgSchema("meeting");

// ─── Config entries (config/metadata keystone) ──────────────────────────────────

export const configEntries = meetingSchema.table("config_entries", {
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

/** Drizzle schema map fragment — merged into shared/db.ts + scanner-db.ts. */
export const configRegistryModule = { configEntries };
