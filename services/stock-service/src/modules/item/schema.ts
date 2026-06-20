import {
  pgSchema, uuid, text, integer, boolean, varchar, timestamp,
} from "drizzle-orm/pg-core";

export const itemSchema = pgSchema("item");

export const stockItemCategories = itemSchema.table("stock_item_categories", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  name:      text("name").notNull(),
  code:      text("code").notNull(),
  itemType:  varchar("item_type", { length: 16 }).notNull().default("consumable"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export const stockUoms = itemSchema.table("stock_uoms", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  name:      text("name").notNull(),
  symbol:    text("symbol").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export const stockItems = itemSchema.table("stock_items", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  name:             text("name").notNull(),
  code:             text("code").notNull(),
  categoryId:       uuid("category_id").notNull(),
  uomId:            uuid("uom_id").notNull(),
  itemType:         varchar("item_type", { length: 16 }).notNull().default("consumable"),
  reorderLevel:     integer("reorder_level").notNull().default(0),
  reorderQty:       integer("reorder_qty").notNull().default(0),
  valuationMethod:  varchar("valuation_method", { length: 8 }).notNull().default("WAVG"),
  isActive:         boolean("is_active").notNull().default(true),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

export type ItemCategoryRow    = typeof stockItemCategories.$inferSelect;
export type ItemCategoryInsert = typeof stockItemCategories.$inferInsert;
export type UomRow             = typeof stockUoms.$inferSelect;
export type UomInsert          = typeof stockUoms.$inferInsert;
export type ItemRow            = typeof stockItems.$inferSelect;
export type ItemInsert         = typeof stockItems.$inferInsert;

export const schema = { stockItemCategories, stockUoms, stockItems };
