import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text, boolean, date } from "drizzle-orm/pg-core";

const sewerageSchema = pgSchema("civitas_sewerage");

export const sewerageDesludgingBookings = sewerageSchema.table("sewerage_desludging_bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  bookingNumber: varchar("booking_number", { length: 32 }).notNull(),
  requestedBy: uuid("requested_by").notNull(),
  address: jsonb("address").$type<Record<string, unknown>>(),
  tankCapacityLitres: integer("tank_capacity_litres"),
  requestedDate: date("requested_date"),
  requestedSlot: varchar("requested_slot", { length: 24 }),
  status: varchar("status", { length: 24 }).notNull().default("requested"),
  vehicleId: text("vehicle_id"),
  feeMinor: integer("fee_minor"),
  feePaid: boolean("fee_paid").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type BookingRow = typeof sewerageDesludgingBookings.$inferSelect;
export type BookingInsert = typeof sewerageDesludgingBookings.$inferInsert;
export const schema = { sewerageDesludgingBookings };
