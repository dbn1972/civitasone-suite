import {
  pgSchema, uuid, text, integer, boolean, timestamp,
} from "drizzle-orm/pg-core";

export const warehouseSchema = pgSchema("warehouse");

export const stockWarehouses = warehouseSchema.table("stock_warehouses", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  name:      text("name").notNull(),
  code:      text("code").notNull(),
  address:   text("address"),
  isActive:  boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export const stockLocations = warehouseSchema.table("stock_locations", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  warehouseId: uuid("warehouse_id").notNull(),
  name:        text("name").notNull(),
  code:        text("code").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type WarehouseRow    = typeof stockWarehouses.$inferSelect;
export type WarehouseInsert = typeof stockWarehouses.$inferInsert;
export type LocationRow     = typeof stockLocations.$inferSelect;
export type LocationInsert  = typeof stockLocations.$inferInsert;

export const schema = { stockWarehouses, stockLocations };
