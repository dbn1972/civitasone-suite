import { pgSchema, uuid, varchar, integer, bigint, date, timestamp, text } from "drizzle-orm/pg-core";

const parkingSchema = pgSchema("parking");

export const parkingPasses = parkingSchema.table("parking_passes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  passNumber: varchar("pass_number", { length: 64 }).notNull().unique(),
  facilityId: uuid("facility_id").notNull(),
  holderName: text("holder_name").notNull(),
  vehicleNumber: varchar("vehicle_number", { length: 20 }).notNull(),
  vehicleType: varchar("vehicle_type", { length: 32 }).notNull(),
  passType: varchar("pass_type", { length: 16 }).notNull(),
  validFrom: date("valid_from").notNull(),
  validUntil: date("valid_until").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("INR"),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  paymentRef: text("payment_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type PassRow = typeof parkingPasses.$inferSelect;
export type PassInsert = typeof parkingPasses.$inferInsert;

export const schema = { parkingPasses };
