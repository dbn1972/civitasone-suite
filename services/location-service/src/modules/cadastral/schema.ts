import { pgSchema, uuid, varchar, numeric, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

/** Cadastral tables — created + tenant-isolated in migration 0014. */
export const locationSchema = pgSchema("location");

export const cadastralParcels = locationSchema.table("cadastral_parcels", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  parcelNo: varchar("parcel_no", { length: 64 }).notNull(),
  village: varchar("village", { length: 128 }).notNull(),
  district: varchar("district", { length: 128 }).notNull(),
  areaSquareMeters: numeric("area_square_meters", { precision: 14, scale: 2 }).notNull(),
  boundary: jsonb("boundary").$type<Array<{ lat: number; lng: number }>>().notNull(),
  landUse: varchar("land_use", { length: 32 }).notNull(),
  ownershipType: varchar("ownership_type", { length: 32 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const cadastralParcelHistory = locationSchema.table("cadastral_parcel_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  parcelId: uuid("parcel_id").notNull(),
  eventType: varchar("event_type", { length: 32 }).notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>(),
  actorId: uuid("actor_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cadastralSurveys = locationSchema.table("cadastral_surveys", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  parcelIds: jsonb("parcel_ids").$type<string[]>().notNull(),
  surveyorId: uuid("surveyor_id").notNull(),
  scheduledDate: timestamp("scheduled_date", { withTimezone: true }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("scheduled"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export const cadastralDisputes = locationSchema.table("cadastral_disputes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  parcelAId: uuid("parcel_a_id").notNull(),
  parcelBId: uuid("parcel_b_id").notNull(),
  description: varchar("description", { length: 2000 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("filed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export type CadastralParcelRow = typeof cadastralParcels.$inferSelect;

export type CadastralParcelView = {
  id: string;
  tenantId: string;
  parcelNo: string;
  village: string;
  district: string;
  areaSquareMeters: number;
  boundary: Array<{ lat: number; lng: number }>;
  landUse: string;
  ownershipType: string;
  status: string;
  version: number;
};

export const schema = { cadastralParcels, cadastralParcelHistory, cadastralSurveys, cadastralDisputes };
