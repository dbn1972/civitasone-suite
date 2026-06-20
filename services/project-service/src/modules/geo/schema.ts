import { pgSchema, uuid, text, integer, numeric, timestamp, varchar } from "drizzle-orm/pg-core";

export const geoSchema = pgSchema("geo");

export const projectGeoTags = geoSchema.table("project_geo_tags", {
  id:            uuid("id").primaryKey().defaultRandom(),
  projectId:     uuid("project_id").notNull(),
  tenantId:      uuid("tenant_id").notNull(),
  lat:           numeric("lat", { precision: 10, scale: 7 }).notNull(),
  lon:           numeric("lon", { precision: 10, scale: 7 }).notNull(),
  locationName:  text("location_name"),
  description:   text("description"),
  taggedBy:      uuid("tagged_by").notNull(),
  taggedAt:      timestamp("tagged_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export const projectSitePhotos = geoSchema.table("project_site_photos", {
  id:            uuid("id").primaryKey().defaultRandom(),
  projectId:     uuid("project_id").notNull(),
  geoTagId:      uuid("geo_tag_id"),
  tenantId:      uuid("tenant_id").notNull(),
  s3Key:         text("s3_key").notNull(),
  originalName:  text("original_name").notNull(),
  description:   text("description"),
  uploadedBy:    uuid("uploaded_by").notNull(),
  uploadedAt:    timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export type GeoTagRow       = typeof projectGeoTags.$inferSelect;
export type GeoTagInsert    = typeof projectGeoTags.$inferInsert;
export type SitePhotoRow    = typeof projectSitePhotos.$inferSelect;
export type SitePhotoInsert = typeof projectSitePhotos.$inferInsert;

export const schema = { projectGeoTags, projectSitePhotos };
