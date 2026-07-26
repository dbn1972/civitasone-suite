import { pgSchema, uuid, varchar, numeric, timestamp } from "drizzle-orm/pg-core";

/** location.geo_points (migration 0019) — generic monitoring point registry. */
export const locationSchema = pgSchema("location");

export const geoPoints = locationSchema.table("geo_points", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  domain: varchar("domain", { length: 48 }).notNull(),
  refId: varchar("ref_id", { length: 128 }).notNull(),
  lat: numeric("lat", { precision: 10, scale: 7 }).notNull(),
  lng: numeric("lng", { precision: 10, scale: 7 }).notNull(),
  label: varchar("label", { length: 256 }),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export type Marker = {
  id: string;
  domain: string;
  refId: string;
  lat: number;
  lng: number;
  label: string | null;
  status: string;
};

export const schema = { geoPoints };
