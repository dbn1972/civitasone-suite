import { pgSchema, uuid, varchar, integer, timestamp, boolean, doublePrecision, jsonb, pgEnum } from "drizzle-orm/pg-core";

export const geofenceSchema = pgSchema("geofence");

export const geofenceTypeEnum = geofenceSchema.enum("geofence_type", [
  "office",
  "site",
  "zone",
]);

export const geofences = geofenceSchema.table("geofences", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  type: geofenceTypeEnum("type").notNull(),
  centerLat: doublePrecision("center_lat").notNull(),
  centerLng: doublePrecision("center_lng").notNull(),
  radiusMeters: integer("radius_meters").notNull(),
  polygon: jsonb("polygon").$type<Array<{ lat: number; lng: number }>>(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type GeofenceRow = typeof geofences.$inferSelect;
export type GeofenceInsert = typeof geofences.$inferInsert;

export type GeofenceView = {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  polygon: Array<{ lat: number; lng: number }> | null;
  active: boolean;
  version: number;
};

export const schema = { geofences };
