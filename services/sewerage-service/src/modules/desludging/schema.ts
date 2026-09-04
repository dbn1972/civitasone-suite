import { pgSchema, uuid, varchar, integer, bigint, timestamp, jsonb, text, boolean, date } from "drizzle-orm/pg-core";

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
  // Money minor units (paise), stored as bigint (see migrations/
  // 0002_money_bigint_paise.sql) — was `integer`; see billing/schema.ts's
  // amountMinor comment for the full rationale, identical here.
  feeMinor: bigint("fee_minor", { mode: "bigint" }),
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
