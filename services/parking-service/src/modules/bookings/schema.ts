import { pgSchema, uuid, varchar, integer, bigint, timestamp, text } from "drizzle-orm/pg-core";

const parkingSchema = pgSchema("parking");

export const parkingBookings = parkingSchema.table("parking_bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  bookingNumber: varchar("booking_number", { length: 64 }).notNull().unique(),
  facilityId: uuid("facility_id").notNull(),
  vehicleNumber: varchar("vehicle_number", { length: 20 }).notNull(),
  vehicleType: varchar("vehicle_type", { length: 32 }).notNull(),
  entryTime: timestamp("entry_time", { withTimezone: true }),
  exitTime: timestamp("exit_time", { withTimezone: true }),
  durationMinutes: integer("duration_minutes"),
  amountMinor: bigint("amount_minor", { mode: "bigint" }),
  currency: varchar("currency", { length: 3 }).notNull().default("INR"),
  status: varchar("status", { length: 32 }).notNull().default("booked"),
  paymentRef: text("payment_ref"),
  spaceNumber: text("space_number"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type BookingRow = typeof parkingBookings.$inferSelect;
export type BookingInsert = typeof parkingBookings.$inferInsert;

export const schema = { parkingBookings };
