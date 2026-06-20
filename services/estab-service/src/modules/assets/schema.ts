import {
  pgSchema, uuid, text, varchar, integer, boolean, timestamp, date,
} from "drizzle-orm/pg-core";

export const assetsSchema = pgSchema("assets");

export const estabVehicles = assetsSchema.table("estab_vehicles", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  regNo:       text("reg_no").notNull(),
  makeModel:   text("make_model").notNull(),
  fuelType:    varchar("fuel_type", { length: 16 }).notNull().default("petrol"),
  allocatedTo: uuid("allocated_to"),
  odometerKm:  integer("odometer_km").notNull().default(0),
  status:      varchar("status", { length: 24 }).notNull().default("available"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const estabDrivers = assetsSchema.table("estab_drivers", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  employeeRef:   uuid("employee_ref").notNull(),
  licenceNo:     text("licence_no").notNull(),
  licenceExpiry: date("licence_expiry").notNull(),
  status:        varchar("status", { length: 24 }).notNull().default("active"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export const estabVehicleBookings = assetsSchema.table("estab_vehicle_bookings", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  vehicleId:   uuid("vehicle_id").notNull(),
  requestedBy: uuid("requested_by").notNull(),
  driverId:    uuid("driver_id"),
  purpose:     text("purpose").notNull(),
  fromDt:      timestamp("from_dt", { withTimezone: true }).notNull(),
  toDt:        timestamp("to_dt", { withTimezone: true }).notNull(),
  status:      varchar("status", { length: 24 }).notNull().default("pending"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type VehicleRow       = typeof estabVehicles.$inferSelect;
export type VehicleInsert    = typeof estabVehicles.$inferInsert;
export type VehicleBookingRow    = typeof estabVehicleBookings.$inferSelect;
export type VehicleBookingInsert = typeof estabVehicleBookings.$inferInsert;

export const schema = { estabVehicles, estabDrivers, estabVehicleBookings };
