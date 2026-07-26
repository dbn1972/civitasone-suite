import { pgSchema, uuid, text, varchar, integer, date, timestamp } from "drizzle-orm/pg-core";

/**
 * CAP-052 — API catalogue persistence (gateway-service, DB civitas_gateway).
 * Mirrors migration 0001_api_catalogue.sql. Schema `catalogue`.
 */
export const catalogueSchema = pgSchema("catalogue");

export const apiEntry = catalogueSchema.table("api_entry", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  name:            text("name").notNull(),
  module:          text("module").notNull(),
  version:         text("version").notNull().default("v1"),
  path:            text("path").notNull(),
  method:          varchar("method", { length: 10 }).notNull().default("GET"),
  upstream:        text("upstream"),
  owner:           text("owner"),
  status:          varchar("status", { length: 16 }).notNull().default("draft"),
  description:     text("description"),
  deprecationDate: date("deprecation_date"),
  sunsetDate:      date("sunset_date"),
  source:          varchar("source", { length: 16 }).notNull().default("manual"),
  rowVersion:      integer("row_version").notNull().default(1),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by"),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apiChangelog = catalogueSchema.table("api_changelog", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  apiId:      uuid("api_id").notNull(),
  changeType: varchar("change_type", { length: 24 }).notNull(),
  fromStatus: varchar("from_status", { length: 16 }),
  toStatus:   varchar("to_status", { length: 16 }),
  note:       text("note"),
  actorId:    uuid("actor_id"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ApiEntryRow        = typeof apiEntry.$inferSelect;
export type ApiEntryInsert     = typeof apiEntry.$inferInsert;
export type ApiChangelogRow    = typeof apiChangelog.$inferSelect;
export type ApiChangelogInsert = typeof apiChangelog.$inferInsert;

export const schema = { apiEntry, apiChangelog };
