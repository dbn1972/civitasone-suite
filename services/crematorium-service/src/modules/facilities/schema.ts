import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text } from "drizzle-orm/pg-core";

export const crematoriumSchema = pgSchema("crematorium");

export const crematoriumFacilities = crematoriumSchema.table("crematorium_facilities", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  facilityName: text("facility_name").notNull(),
  facilityType: varchar("facility_type", { length: 32 }).notNull(),
  address: jsonb("address").$type<{ line1: string; line2?: string; city: string; pin: string; ward?: string }>().notNull(),
  ward: varchar("ward", { length: 64 }),
  totalSlots: integer("total_slots").notNull(),
  operatingHours: jsonb("operating_hours").$type<{ open: string; close: string; days?: string[] }>(),
  contactPerson: text("contact_person"),
  contactPhone: varchar("contact_phone", { length: 20 }),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type FacilityRow = typeof crematoriumFacilities.$inferSelect;
export type FacilityInsert = typeof crematoriumFacilities.$inferInsert;

export const schema = { crematoriumFacilities };
