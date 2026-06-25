/**
 * items module — Drizzle schema in Postgres schema `inventory`.
 *
 * Item master: categories, units of measure (UoM) and the items themselves
 * (with reorder levels + valuation method + standard unit cost in paise).
 * Every table carries tenant_id + a `version` column for optimistic locking.
 */
import { pgSchema, uuid, varchar, integer, bigint, char, boolean, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("inventory");

export const categories = domainSchema.table("categories", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  name:      varchar("name", { length: 200 }).notNull(),
  code:      varchar("code", { length: 64 }).notNull(),
  parentId:  uuid("parent_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export const uoms = domainSchema.table("uoms", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  name:      varchar("name", { length: 120 }).notNull(),
  symbol:    varchar("symbol", { length: 16 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export const items = domainSchema.table("items", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  name:            varchar("name", { length: 200 }).notNull(),
  sku:             varchar("sku", { length: 64 }),
  status:          varchar("status", { length: 24 }).notNull().default("active"),
  categoryId:      uuid("category_id"),
  uomId:           uuid("uom_id"),
  itemType:        varchar("item_type", { length: 16 }).notNull().default("consumable"),
  reorderLevel:    integer("reorder_level").notNull().default(0),
  reorderQty:      integer("reorder_qty").notNull().default(0),
  valuationMethod: varchar("valuation_method", { length: 8 }).notNull().default("WAVG"),
  unitCostMinor:   bigint("unit_cost_minor", { mode: "bigint" }).notNull().default(0n),
  currency:        char("currency", { length: 3 }).notNull().default("INR"),
  isActive:        boolean("is_active").notNull().default(true),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export type CategoryRow    = typeof categories.$inferSelect;
export type CategoryInsert = typeof categories.$inferInsert;
export type UomRow         = typeof uoms.$inferSelect;
export type UomInsert      = typeof uoms.$inferInsert;
export type ItemRow        = typeof items.$inferSelect;
export type ItemInsert     = typeof items.$inferInsert;

/** Read projection returned to API consumers (money as string for JSON safety). */
export type ItemView = {
  id: string;
  tenantId: string;
  name: string;
  sku: string | null;
  status: string;
  categoryId: string | null;
  category: string | null;
  uomId: string | null;
  uom: string | null;
  itemType: string;
  reorderLevel: number;
  reorderQty: number;
  valuationMethod: string;
  unitCostMinor: string;
  currency: string;
  isActive: boolean;
  version: number;
};

export const schema = { categories, uoms, items };
