import { pgSchema, uuid, varchar, jsonb, timestamp } from "drizzle-orm/pg-core";

/** location.spatial_features — generic feature store (migration 0016). */
export const locationSchema = pgSchema("location");

export const spatialFeatures = locationSchema.table("spatial_features", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  dataset: varchar("dataset", { length: 128 }).notNull(),
  name: varchar("name", { length: 256 }),
  featureType: varchar("feature_type", { length: 32 }).notNull(),
  properties: jsonb("properties").$type<Record<string, unknown>>().notNull().default({}),
  source: varchar("source", { length: 16 }).notNull().default("geojson"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export const schema = { spatialFeatures };
