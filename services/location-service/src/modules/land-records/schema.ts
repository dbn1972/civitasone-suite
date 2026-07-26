import { pgSchema, uuid, varchar, numeric, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

/** location.land_records — created in migration 0013, tenant-isolated in 0014. */
export const locationSchema = pgSchema("location");

export const landRecords = locationSchema.table("land_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  surveyNo: varchar("survey_no", { length: 64 }).notNull(),
  khasraNo: varchar("khasra_no", { length: 64 }),
  village: varchar("village", { length: 128 }).notNull(),
  district: varchar("district", { length: 128 }).notNull(),
  areaHectares: numeric("area_hectares", { precision: 12, scale: 4 }).notNull(),
  ownerName: varchar("owner_name", { length: 256 }).notNull(),
  landType: varchar("land_type", { length: 32 }).notNull(),
  coordinates: jsonb("coordinates").$type<Array<{ lat: number; lng: number }>>(),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  mutationDate: timestamp("mutation_date", { withTimezone: true }),
  mutationType: varchar("mutation_type", { length: 32 }),
  documentRef: varchar("document_ref", { length: 256 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type LandRecordRow = typeof landRecords.$inferSelect;
export type LandRecordInsert = typeof landRecords.$inferInsert;

export type LandRecordView = {
  id: string;
  tenantId: string;
  surveyNo: string;
  khasraNo: string | null;
  village: string;
  district: string;
  areaHectares: number;
  ownerName: string;
  landType: string;
  coordinates: Array<{ lat: number; lng: number }> | null;
  status: string;
  mutationDate: string | null;
  mutationType: string | null;
  documentRef: string | null;
  version: number;
};

export const schema = { landRecords };
