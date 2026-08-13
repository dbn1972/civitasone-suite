import {
  pgSchema, uuid, text, integer, bigint, char, varchar, boolean, date, timestamp, jsonb,
} from "drizzle-orm/pg-core";

export const waterTankerSchema = pgSchema("water_tanker");

export const assetWaterTankerBookings = waterTankerSchema.table("asset_water_tanker_bookings", {
  id:                    uuid("id").primaryKey().defaultRandom(),
  tenantId:              uuid("tenant_id").notNull(),
  bookingNumber:         text("booking_number").notNull(),
  requestedBy:           uuid("requested_by").notNull(),
  deliveryAddress:       jsonb("delivery_address"),
  ward:                  varchar("ward", { length: 64 }),
  tankerCapacityLitres:  integer("tanker_capacity_litres").notNull(),
  requestedDate:         date("requested_date").notNull(),
  requestedSlot:         varchar("requested_slot", { length: 16 }),
  status:                varchar("status", { length: 16 }).notNull().default("requested"),
  scheduledDate:         date("scheduled_date"),
  tankerVehicleId:       text("tanker_vehicle_id"),
  driverId:              uuid("driver_id"),
  dispatchedAt:          timestamp("dispatched_at", { withTimezone: true }),
  deliveredAt:           timestamp("delivered_at", { withTimezone: true }),
  feeMinor:              bigint("fee_minor", { mode: "bigint" }).notNull().default(0n),
  currency:              char("currency", { length: 3 }).notNull().default("INR"),
  feePaid:               boolean("fee_paid").notNull().default(false),
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:             uuid("created_by").notNull(),
  updatedBy:             uuid("updated_by").notNull(),
  version:               integer("version").notNull().default(1),
});

export type WaterTankerBookingRow    = typeof assetWaterTankerBookings.$inferSelect;
export type WaterTankerBookingInsert = typeof assetWaterTankerBookings.$inferInsert;

export const schema = { assetWaterTankerBookings };
