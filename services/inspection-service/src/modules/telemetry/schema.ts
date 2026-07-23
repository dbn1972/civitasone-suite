/**
 * inspection-service: Telemetry / IoT module Drizzle schema.
 *
 * Defines the `telemetry` PG schema with tables:
 * - devices — registered IoT devices (sensors, drones, cameras, gateways)
 * - telemetry_readings — time-series sensor readings (numeric precision)
 * - telemetry_alerts — alerts generated from threshold/anomaly detection
 * - alert_rules — configurable alert trigger rules
 *
 * _Requirements: SVC-110_
 */
import {
  pgSchema,
  uuid,
  text,
  integer,
  varchar,
  timestamp,
  jsonb,
  numeric,
  boolean,
} from "drizzle-orm/pg-core";

/** The `telemetry` PG schema — device telemetry and IoT management. */
export const telemetrySchema = pgSchema("telemetry");

// ── telemetry.devices ─────────────────────────────────────────────────────────

export const devices = telemetrySchema.table("devices", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  deviceType:       varchar("device_type", { length: 24 }).notNull()
                    .$type<"sensor" | "drone" | "camera" | "iot_gateway">(),
  deviceIdentifier: text("device_identifier").notNull(),
  name:             text("name").notNull(),
  entityId:         uuid("entity_id"),
  latitude:         numeric("latitude", { precision: 10, scale: 7 }),
  longitude:        numeric("longitude", { precision: 10, scale: 7 }),
  status:           varchar("status", { length: 16 }).notNull().default("active")
                    .$type<"active" | "inactive" | "maintenance">(),
  lastSeenAt:       timestamp("last_seen_at", { withTimezone: true }),
  metadata:         jsonb("metadata"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

// ── telemetry.telemetry_readings ──────────────────────────────────────────────

export const telemetryReadings = telemetrySchema.table("telemetry_readings", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  deviceId:   uuid("device_id").notNull(),
  readingType: varchar("reading_type", { length: 64 }).notNull(),
  value:      numeric("value", { precision: 18, scale: 6 }).notNull(),
  unit:       varchar("unit", { length: 24 }).notNull(),
  latitude:   numeric("latitude", { precision: 10, scale: 7 }),
  longitude:  numeric("longitude", { precision: 10, scale: 7 }),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  metadata:   jsonb("metadata"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  version:    integer("version").notNull().default(1),
});

// ── telemetry.telemetry_alerts ────────────────────────────────────────────────

export const telemetryAlerts = telemetrySchema.table("telemetry_alerts", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  deviceId:       uuid("device_id").notNull(),
  readingId:      uuid("reading_id"),
  alertType:      varchar("alert_type", { length: 24 }).notNull()
                  .$type<"threshold_exceeded" | "anomaly" | "offline">(),
  severity:       varchar("severity", { length: 16 }).notNull()
                  .$type<"critical" | "major" | "minor">(),
  thresholdValue: numeric("threshold_value", { precision: 18, scale: 6 }),
  actualValue:    numeric("actual_value", { precision: 18, scale: 6 }),
  status:         varchar("status", { length: 24 }).notNull().default("open")
                  .$type<"open" | "acknowledged" | "resolved" | "finding_created">(),
  findingId:      uuid("finding_id"),
  resolvedAt:     timestamp("resolved_at", { withTimezone: true }),
  resolvedBy:     uuid("resolved_by"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

// ── telemetry.alert_rules ─────────────────────────────────────────────────────

export const alertRules = telemetrySchema.table("alert_rules", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  deviceType:     varchar("device_type", { length: 24 }).notNull(),
  readingType:    varchar("reading_type", { length: 64 }).notNull(),
  operator:       varchar("operator", { length: 4 }).notNull()
                  .$type<"gt" | "lt" | "gte" | "lte" | "eq">(),
  thresholdValue: numeric("threshold_value", { precision: 18, scale: 6 }).notNull(),
  severity:       varchar("severity", { length: 16 }).notNull()
                  .$type<"critical" | "major" | "minor">(),
  isActive:       boolean("is_active").notNull().default(true),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

// ── Inferred types ────────────────────────────────────────────────────────────
export type DeviceRow = typeof devices.$inferSelect;
export type DeviceInsert = typeof devices.$inferInsert;
export type TelemetryReadingRow = typeof telemetryReadings.$inferSelect;
export type TelemetryReadingInsert = typeof telemetryReadings.$inferInsert;
export type TelemetryAlertRow = typeof telemetryAlerts.$inferSelect;
export type TelemetryAlertInsert = typeof telemetryAlerts.$inferInsert;
export type AlertRuleRow = typeof alertRules.$inferSelect;
export type AlertRuleInsert = typeof alertRules.$inferInsert;

export const schema = { devices, telemetryReadings, telemetryAlerts, alertRules };
