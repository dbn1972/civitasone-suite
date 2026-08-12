import { pgSchema, uuid, varchar, integer, bigint, timestamp, jsonb, text } from "drizzle-orm/pg-core";

export const parkingSchema = pgSchema("parking");

export const parkingFacilities = parkingSchema.table("parking_facilities", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  facilityName: text("facility_name").notNull(),
  facilityType: varchar("facility_type", { length: 32 }).notNull(),
  address: jsonb("address").$type<{ line1: string; line2?: string; city: string; pin: string; ward?: string }>().notNull(),
  ward: varchar("ward", { length: 64 }),
  totalSpaces: integer("total_spaces").notNull(),
  availableSpaces: integer("available_spaces").notNull(),
  operatingHours: jsonb("operating_hours").$type<{ open: string; close: string; days?: string[] }>(),
  tariffPerHourMinor: bigint("tariff_per_hour_minor", { mode: "bigint" }),
  tariffPerDayMinor: bigint("tariff_per_day_minor", { mode: "bigint" }),
  monthlyPassMinor: bigint("monthly_pass_minor", { mode: "bigint" }),
  annualPassMinor: bigint("annual_pass_minor", { mode: "bigint" }),
  currency: varchar("currency", { length: 3 }).notNull().default("INR"),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  contactPerson: text("contact_person"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type FacilityRow = typeof parkingFacilities.$inferSelect;
export type FacilityInsert = typeof parkingFacilities.$inferInsert;

export const schema = { parkingFacilities };
