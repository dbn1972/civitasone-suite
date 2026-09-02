import { pgSchema, uuid, varchar, integer, boolean, date, doublePrecision, timestamp } from "drizzle-orm/pg-core";

const attSchema = pgSchema("attendance");
const empSchema = pgSchema("employee");

export const hrmsGeoAttendance = attSchema.table("hrms_geo_attendance", {
  id:                     uuid("id").primaryKey().defaultRandom(),
  tenantId:               uuid("tenant_id").notNull(),
  employeeId:             uuid("employee_id").notNull(),
  attendanceDate:         date("attendance_date").notNull(),
  checkType:              varchar("check_type", { length: 16 }).notNull(),
  latitude:               doublePrecision("latitude").notNull(),
  longitude:              doublePrecision("longitude").notNull(),
  accuracyMeters:         doublePrecision("accuracy_meters"),
  officeLocationId:       uuid("office_location_id"),
  withinGeofence:         boolean("within_geofence").notNull().default(false),
  distanceFromOffice:     doublePrecision("distance_from_office_meters"),
  selfieFileKey:          varchar("selfie_file_key", { length: 1024 }),
  selfieVerified:         boolean("selfie_verified").notNull().default(false),
  deviceId:               varchar("device_id", { length: 256 }),
  ipAddress:              varchar("ip_address", { length: 45 }),
  markedAt:               timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:              uuid("created_by").notNull(),
});

export const hrmsOfficeLocations = empSchema.table("hrms_office_locations", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  name:          varchar("name", { length: 256 }).notNull(),
  address:       varchar("address", { length: 1024 }),
  latitude:      doublePrecision("latitude").notNull(),
  longitude:     doublePrecision("longitude").notNull(),
  radiusMeters:  integer("radius_meters").notNull().default(200),
  isActive:      boolean("is_active").notNull().default(true),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
});

export type GeoAttendanceRow = typeof hrmsGeoAttendance.$inferSelect;
export type OfficeLocationRow = typeof hrmsOfficeLocations.$inferSelect;
