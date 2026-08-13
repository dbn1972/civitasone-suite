import { pgSchema, uuid, varchar, text, jsonb, boolean, integer, bigint, timestamp, char } from "drizzle-orm/pg-core";

const fireApplications = pgSchema("fire_applications");

export const fireApplicationsTable = fireApplications.table("fire_applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  applicationNumber: varchar("application_number", { length: 64 }).notNull().unique(),
  status: varchar("status", { length: 32 }).notNull().default("draft"),
  buildingName: text("building_name").notNull(),
  buildingAddress: jsonb("building_address").notNull(),
  occupancyType: varchar("occupancy_type", { length: 32 }).notNull(),
  buildingHeight: text("building_height"),
  numberOfFloors: integer("number_of_floors"),
  builtUpArea: text("built_up_area"),
  fireSafetyMeasures: jsonb("fire_safety_measures"),
  documents: jsonb("documents"),
  feeMinor: bigint("fee_minor", { mode: "bigint" }),
  feeCurrency: char("fee_currency", { length: 3 }).notNull().default("INR"),
  feePaid: boolean("fee_paid").notNull().default(false),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type FireApplicationRow = typeof fireApplicationsTable.$inferSelect;
export type FireApplicationInsert = typeof fireApplicationsTable.$inferInsert;

export const schema = { fireApplications: fireApplicationsTable };
