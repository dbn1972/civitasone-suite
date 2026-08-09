import {
  pgSchema, uuid, text, integer, varchar, date, timestamp, jsonb,
} from "drizzle-orm/pg-core";

export const streetlightSchema = pgSchema("streetlight");

export const assetStreetlights = streetlightSchema.table("asset_streetlights", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  poleId:              text("pole_id").notNull().unique(),
  location:            jsonb("location"),
  lampType:            varchar("lamp_type", { length: 16 }).notNull(),
  wattage:             integer("wattage").notNull(),
  installationDate:    date("installation_date"),
  status:              varchar("status", { length: 24 }).notNull().default("operational"),
  lastMaintenanceDate: date("last_maintenance_date"),
  circuitId:           text("circuit_id"),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid("created_by").notNull(),
  updatedBy:           uuid("updated_by").notNull(),
  version:             integer("version").notNull().default(1),
});

export const assetStreetlightFaults = streetlightSchema.table("asset_streetlight_faults", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  streetlightId:  uuid("streetlight_id").notNull(),
  faultNumber:    text("fault_number").notNull(),
  reportedBy:     uuid("reported_by").notNull(),
  reportedAt:     timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
  faultType:      varchar("fault_type", { length: 24 }).notNull(),
  description:    text("description"),
  photo:          text("photo"),
  status:         varchar("status", { length: 16 }).notNull().default("reported"),
  assignedTo:     uuid("assigned_to"),
  resolvedAt:     timestamp("resolved_at", { withTimezone: true }),
  resolution:     text("resolution"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export const assetStreetlightRequests = streetlightSchema.table("asset_streetlight_requests", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  requestNumber: text("request_number").notNull(),
  requestedBy:   uuid("requested_by").notNull(),
  requestType:   varchar("request_type", { length: 16 }).notNull(),
  location:      jsonb("location"),
  justification: text("justification"),
  status:        varchar("status", { length: 16 }).notNull().default("submitted"),
  surveyReport:  jsonb("survey_report"),
  approvedBy:    uuid("approved_by"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export type StreetlightRow    = typeof assetStreetlights.$inferSelect;
export type StreetlightInsert = typeof assetStreetlights.$inferInsert;
export type StreetlightFaultRow    = typeof assetStreetlightFaults.$inferSelect;
export type StreetlightFaultInsert = typeof assetStreetlightFaults.$inferInsert;
export type StreetlightRequestRow    = typeof assetStreetlightRequests.$inferSelect;
export type StreetlightRequestInsert = typeof assetStreetlightRequests.$inferInsert;

export const schema = { assetStreetlights, assetStreetlightFaults, assetStreetlightRequests };
