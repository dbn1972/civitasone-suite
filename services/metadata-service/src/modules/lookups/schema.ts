import { pgSchema, uuid, varchar, text, boolean, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const metadataSchema = pgSchema("metadata");

export const kvStore = metadataSchema.table("kv_store", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  ns:        varchar("ns", { length: 128 }).notNull().default("default"),
  k:         varchar("k", { length: 512 }).notNull(),
  v:         jsonb("v").notNull().default(null as unknown as object),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export const lookupTables = metadataSchema.table("lookup_tables", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  code:        varchar("code", { length: 128 }).notNull(),
  label:       varchar("label", { length: 256 }).notNull(),
  description: text("description"),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
});

export const lookupValues = metadataSchema.table("lookup_values", {
  id:        uuid("id").primaryKey().defaultRandom(),
  lookupId:  uuid("lookup_id").notNull(),
  tenantId:  uuid("tenant_id").notNull(),
  valueCode: varchar("value_code", { length: 128 }).notNull(),
  label:     varchar("label", { length: 256 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive:  boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const enumDefinitions = metadataSchema.table("enum_definitions", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  name:      varchar("name", { length: 128 }).notNull(),
  values:    jsonb("values").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export type KvRow          = typeof kvStore.$inferSelect;
export type LookupTableRow = typeof lookupTables.$inferSelect;
export type LookupValueRow = typeof lookupValues.$inferSelect;
export type EnumDefRow     = typeof enumDefinitions.$inferSelect;

export const lookupsModuleSchema = { kvStore, lookupTables, lookupValues, enumDefinitions };
