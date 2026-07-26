import { pgSchema, uuid, varchar, integer, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";

/** location.map_layers (migration 0018). */
export const locationSchema = pgSchema("location");

export const mapLayers = locationSchema.table("map_layers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  sourceType: varchar("source_type", { length: 16 }).notNull(),
  url: varchar("url", { length: 2048 }).notNull(),
  styleJson: jsonb("style_json").$type<Record<string, unknown>>(),
  zIndex: integer("z_index").notNull().default(0),
  visible: boolean("visible").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type MapLayerRow = typeof mapLayers.$inferSelect;

export type MapLayerView = {
  id: string;
  name: string;
  sourceType: string;
  url: string;
  styleJson: Record<string, unknown> | null;
  zIndex: number;
  visible: boolean;
  version: number;
};

export const schema = { mapLayers };
