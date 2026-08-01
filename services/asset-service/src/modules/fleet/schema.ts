import {
  pgSchema, uuid, integer, bigint, varchar, numeric, boolean, date, timestamp,
} from "drizzle-orm/pg-core";

// Shared by fleet/ and fleet-devices/ modules — both write to the `asset`
// schema created (fixed) in migrations/0017_fleet_gps.sql and extended in
// migrations/0018_fleet_devices_rls.sql.
export const fleetSchema = pgSchema("asset");

export const fleetVehicles = fleetSchema.table("fleet_vehicles", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  registrationNo:   varchar("registration_no", { length: 20 }).notNull(),
  make:             varchar("make", { length: 64 }),
  model:            varchar("model", { length: 64 }),
  year:             integer("year"),
  fuelType:         varchar("fuel_type", { length: 16 }),
  assignedDriverId: uuid("assigned_driver_id"),
  currentLat:       numeric("current_lat", { precision: 10, scale: 7 }),
  currentLng:       numeric("current_lng", { precision: 10, scale: 7 }),
  lastGpsAt:        timestamp("last_gps_at", { withTimezone: true }),
  fuelLevelPct:     integer("fuel_level_pct"),
  odometerKm:       integer("odometer_km"),
  status:           varchar("status", { length: 16 }).notNull().default("active"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  version:          integer("version").notNull().default(1),
});

export const fleetMaintenance = fleetSchema.table("fleet_maintenance", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  tenantId:             uuid("tenant_id").notNull(),
  vehicleId:            uuid("vehicle_id").notNull(),
  type:                 varchar("type", { length: 32 }).notNull(),
  scheduledDate:        date("scheduled_date").notNull(),
  status:               varchar("status", { length: 16 }).notNull().default("scheduled"),
  costMinor:            bigint("cost_minor", { mode: "bigint" }),
  odometerThresholdKm:  integer("odometer_threshold_km"),
  createdBy:            uuid("created_by"),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const fleetDevices = fleetSchema.table("fleet_devices", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  vehicleId:  uuid("vehicle_id").notNull(),
  deviceImei: varchar("device_imei", { length: 15 }).notNull(),
  protocol:   varchar("protocol", { length: 16 }).notNull(),
  simIccid:   varchar("sim_iccid", { length: 32 }),
  status:     varchar("status", { length: 16 }).notNull().default("active"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  version:    integer("version").notNull().default(1),
});

export const fleetDeviceTelemetry = fleetSchema.table("fleet_device_telemetry", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  deviceId:     uuid("device_id").notNull(),
  lat:          numeric("lat", { precision: 10, scale: 7 }).notNull(),
  lng:          numeric("lng", { precision: 10, scale: 7 }).notNull(),
  speed:        numeric("speed", { precision: 6, scale: 2 }),
  heading:      numeric("heading", { precision: 5, scale: 2 }),
  fuelLevelPct: integer("fuel_level_pct"),
  engineOn:     boolean("engine_on"),
  recordedAt:   timestamp("recorded_at", { withTimezone: true }).notNull(),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FleetVehicleRow    = typeof fleetVehicles.$inferSelect;
export type FleetVehicleInsert = typeof fleetVehicles.$inferInsert;
export type FleetMaintenanceRow    = typeof fleetMaintenance.$inferSelect;
export type FleetMaintenanceInsert = typeof fleetMaintenance.$inferInsert;
export type FleetDeviceRow    = typeof fleetDevices.$inferSelect;
export type FleetDeviceInsert = typeof fleetDevices.$inferInsert;
export type FleetDeviceTelemetryRow    = typeof fleetDeviceTelemetry.$inferSelect;
export type FleetDeviceTelemetryInsert = typeof fleetDeviceTelemetry.$inferInsert;

export const schema = { fleetVehicles, fleetMaintenance, fleetDevices, fleetDeviceTelemetry };
