import { pgSchema, uuid, varchar, integer, bigint, timestamp, jsonb, text } from "drizzle-orm/pg-core";

const parkingSchema = pgSchema("parking");

export const parkingViolations = parkingSchema.table("parking_violations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  violationNumber: varchar("violation_number", { length: 64 }).notNull().unique(),
  location: jsonb("location").$type<{ lat?: number; lng?: number; address?: string; zone?: string }>(),
  vehicleNumber: varchar("vehicle_number", { length: 20 }).notNull(),
  violationType: varchar("violation_type", { length: 32 }).notNull(),
  photo: text("photo"),
  fineMinor: bigint("fine_minor", { mode: "bigint" }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("INR"),
  status: varchar("status", { length: 32 }).notNull().default("issued"),
  issuedBy: uuid("issued_by").notNull(),
  challanRef: text("challan_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ViolationRow = typeof parkingViolations.$inferSelect;
export type ViolationInsert = typeof parkingViolations.$inferInsert;

export const schema = { parkingViolations };
