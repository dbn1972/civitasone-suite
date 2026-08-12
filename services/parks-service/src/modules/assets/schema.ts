import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text, date } from "drizzle-orm/pg-core";

const parksSchema = pgSchema("civitas_parks");

export const parksAssets = parksSchema.table("parks_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  assetCode: varchar("asset_code", { length: 32 }).notNull(),
  assetType: varchar("asset_type", { length: 24 }).notNull(),
  name: text("name"),
  location: jsonb("location").$type<Record<string, unknown>>(),
  area: text("area"),
  areaUnit: varchar("area_unit", { length: 16 }),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  lastMaintenanceDate: date("last_maintenance_date"),
  maintenanceHistory: jsonb("maintenance_history").$type<Record<string, unknown>[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type AssetRow = typeof parksAssets.$inferSelect;
export type AssetInsert = typeof parksAssets.$inferInsert;
export const schema = { parksAssets };
