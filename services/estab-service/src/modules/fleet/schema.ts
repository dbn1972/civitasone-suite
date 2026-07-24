/**
 * fleet module — extended fleet management (SVC-059).
 * Fuel logs, trips/log-book, permits/insurance/PUC/fitness validity,
 * utilisation reporting, driver duty roster.
 *
 * PG Schema: `fleet`
 * All money as bigint paise. Optimistic locking via `version`.
 */
import {
  pgSchema, uuid, text, varchar, integer, bigint, char, date, timestamp, numeric, boolean,
} from "drizzle-orm/pg-core";

export const fleetSchema = pgSchema("fleet");

/** Fuel log — each refuelling event with litres, cost, odometer. */
export const fuelLogs = fleetSchema.table("fuel_logs", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  vehicleId:     uuid("vehicle_id").notNull(),
  logDate:       date("log_date").notNull(),
  fuelType:      varchar("fuel_type", { length: 16 }).notNull(),
  litres:        numeric("litres", { precision: 10, scale: 2 }).notNull(),
  costMinor:     bigint("cost_minor", { mode: "bigint" }).notNull(),
  currency:      char("currency", { length: 3 }).notNull().default("INR"),
  odometerKm:    integer("odometer_km").notNull(),
  pumpName:      text("pump_name"),
  receiptRef:    text("receipt_ref"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  version:       integer("version").notNull().default(1),
});

/** Trip/log-book — each trip with driver, start/end odometer, purpose. */
export const tripLogs = fleetSchema.table("trip_logs", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  vehicleId:       uuid("vehicle_id").notNull(),
  driverId:        uuid("driver_id"),
  tripDate:        date("trip_date").notNull(),
  startOdometer:   integer("start_odometer").notNull(),
  endOdometer:     integer("end_odometer"),
  startTime:       timestamp("start_time", { withTimezone: true }).notNull(),
  endTime:         timestamp("end_time", { withTimezone: true }),
  purpose:         text("purpose").notNull(),
  passengerName:   text("passenger_name"),
  route:           text("route"),
  status:          varchar("status", { length: 24 }).notNull().default("in_progress"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

/**
 * Vehicle documents — permits, insurance, PUC, fitness certificates.
 * Each document has validity dates and generates reminders before expiry.
 */
export const vehicleDocuments = fleetSchema.table("vehicle_documents", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  vehicleId:    uuid("vehicle_id").notNull(),
  docType:      varchar("doc_type", { length: 32 }).notNull(),
  docNumber:    text("doc_number"),
  issuedAt:     date("issued_at"),
  validFrom:    date("valid_from").notNull(),
  validUntil:   date("valid_until").notNull(),
  issuer:       text("issuer"),
  amountMinor:  bigint("amount_minor", { mode: "bigint" }),
  currency:     char("currency", { length: 3 }).notNull().default("INR"),
  status:       varchar("status", { length: 24 }).notNull().default("active"),
  reminderSent: boolean("reminder_sent").notNull().default(false),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

/** Driver duty roster — shift assignments for drivers. */
export const driverRoster = fleetSchema.table("driver_roster", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  driverId:    uuid("driver_id").notNull(),
  vehicleId:   uuid("vehicle_id"),
  shiftDate:   date("shift_date").notNull(),
  shiftType:   varchar("shift_type", { length: 16 }).notNull().default("day"),
  status:      varchar("status", { length: 24 }).notNull().default("scheduled"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type FuelLogRow    = typeof fuelLogs.$inferSelect;
export type FuelLogInsert = typeof fuelLogs.$inferInsert;
export type TripLogRow    = typeof tripLogs.$inferSelect;
export type TripLogInsert = typeof tripLogs.$inferInsert;
export type VehicleDocumentRow    = typeof vehicleDocuments.$inferSelect;
export type VehicleDocumentInsert = typeof vehicleDocuments.$inferInsert;
export type DriverRosterRow    = typeof driverRoster.$inferSelect;
export type DriverRosterInsert = typeof driverRoster.$inferInsert;

export const schema = { fuelLogs, tripLogs, vehicleDocuments, driverRoster };
