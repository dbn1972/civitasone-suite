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

export const schema = { eventStore, eventTaxonomy };
