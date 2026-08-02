/**
 * events module — Drizzle schema. Immutable event store for customer interactions.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const cdpSchema = pgSchema("cdp");

export const eventStore = cdpSchema.table("event_store", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  profileId: uuid("profile_id").notNull(),
  eventType: varchar("event_type", { length: 128 }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type EventStoreRow = typeof eventStore.$inferSelect;
export type EventStoreInsert = typeof eventStore.$inferInsert;

/**
 * CDP-004 — event taxonomy governance. One approved contract per event name per
 * tenant; ingestion validates payloads against `schemaJson` of the APPROVED row so
 * an undeclared or retired event name cannot silently pollute the event store.
 */
export const eventTaxonomy = cdpSchema.table("event_taxonomy", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  eventName: varchar("event_name", { length: 128 }).notNull(),
  category: varchar("category", { length: 64 }).notNull().default("behavioural"),
  schemaJson: jsonb("schema_json").$type<Record<string, unknown>>().notNull().default({}),
  status: varchar("status", { length: 24 }).notNull().default("draft"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

export type EventTaxonomyRow = typeof eventTaxonomy.$inferSelect;
export type EventTaxonomyInsert = typeof eventTaxonomy.$inferInsert;

/**
 * CR-CDP-03 — versioned attribute schema behind an event name.
 *
 * `cdp.event_taxonomy` (CDP-004) governs the event *name*: one row, one lifecycle, one
 * current schema. That is not enough for a taxonomy that has to evolve — the moment a
 * producer adds a required field, every event emitted before the change becomes
 * retrospectively invalid and there is no record of what the contract used to be.
 *
 * This table keeps each revision of the attribute schema as an immutable row with its own
 * lifecycle (draft → active → deprecated). Exactly one version is active per event name;
 * activating a new one deprecates its predecessor rather than overwriting it, so an event
 * ingested last quarter can still be validated against the contract that was in force
 * then.
 *
 * `schemaVersion` is the contract revision (a business number, monotonic per event name).
 * `version` is the optimistic-lock counter, as on every other entity.
 */
export const eventTaxonomyVersions = cdpSchema.table("event_taxonomy_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  taxonomyId: uuid("taxonomy_id").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  schemaJson: jsonb("schema_json").$type<Record<string, unknown>>().notNull().default({}),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  notes: varchar("notes", { length: 500 }),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  deprecatedAt: timestamp("deprecated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type EventTaxonomyVersionRow = typeof eventTaxonomyVersions.$inferSelect;
export type EventTaxonomyVersionInsert = typeof eventTaxonomyVersions.$inferInsert;

export const schema = { eventStore, eventTaxonomy, eventTaxonomyVersions };
