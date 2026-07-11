/**
 * visitor-service: device-registry Drizzle schema (migration 0008).
 *
 * Defines the `visitor.devices`, `visitor.device_audit_log`, and
 * `visitor.device_configs` tables for the hardware integration module.
 *
 * `deviceTokenHash` and `oldTokenHash` are DPDP-encrypted PII (AES-256-GCM
 * envelope via `encryptedText()`) — device bearer tokens are sensitive
 * credentials stored at rest with field-level encryption.
 *
 * Requirements validated: 1.1, 1.5, 1.9, 10.3
 */
import {
  pgSchema,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";

export const visitorSchema = pgSchema("visitor");

// ── visitor.devices ───────────────────────────────────────────────────────
export const devices = visitorSchema.table("devices", {
  id:                    uuid("id").primaryKey().defaultRandom(),
  tenantId:              uuid("tenant_id").notNull(),
  deviceType:            varchar("device_type", { length: 16 }).notNull(),
  // device_type: kiosk | printer | scanner | turnstile | barrier
  name:                  varchar("name", { length: 128 }).notNull(),
  serialNumber:          varchar("serial_number", { length: 64 }).notNull(),
  locationId:            uuid("location_id").notNull(), // FK → visitor.locations
  gateId:                uuid("gate_id"),               // FK → visitor.gates (nullable)
  status:                varchar("status", { length: 24 }).notNull().default("pending_activation"),
  // status: pending_activation | active | suspended | deregistered
  authType:              varchar("auth_type", { length: 16 }).notNull(),
  // auth_type: bearer_token | mtls
  deviceTokenHash:       encryptedText("device_token_hash"),  // AES-256-GCM encrypted
  certificateFingerprint: varchar("certificate_fingerprint", { length: 128 }),
  capabilities:          jsonb("capabilities").$type<Record<string, string[]>>().notNull().default({}),
  firmwareVersion:       varchar("firmware_version", { length: 32 }),
  firmwareStatus:        varchar("firmware_status", { length: 16 }).default("current"),
  // firmware_status: current | outdated | critical
  lastSeenAt:            timestamp("last_seen_at", { withTimezone: true }),
  online:                boolean("online").notNull().default(false),
  pendingConfig:         jsonb("pending_config"),
  configVersion:         integer("config_version").notNull().default(0),
  configPushAttempts:    integer("config_push_attempts").notNull().default(0),
  tokenExpiresAt:        timestamp("token_expires_at", { withTimezone: true }),
  tokenRotatedAt:        timestamp("token_rotated_at", { withTimezone: true }),
  oldTokenHash:          encryptedText("old_token_hash"),  // grace period during rotation
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:             uuid("created_by").notNull(),
  updatedBy:             uuid("updated_by").notNull(),
  version:               integer("version").notNull().default(1),
}, (table) => ({
  uniqueSerialPerTenant: uniqueIndex("idx_devices_tenant_serial").on(table.tenantId, table.serialNumber),
}));

// ── visitor.device_audit_log ──────────────────────────────────────────────
export const deviceAuditLog = visitorSchema.table("device_audit_log", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  deviceId:  uuid("device_id").notNull(), // FK → devices
  action:    varchar("action", { length: 32 }).notNull(),
  // action: registered | activated | deregistered | credential_rotated | config_updated | suspended | firmware_flagged
  details:   jsonb("details"),
  actorId:   uuid("actor_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── visitor.device_configs ────────────────────────────────────────────────
export const deviceConfigs = visitorSchema.table("device_configs", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  deviceId:       uuid("device_id").notNull(), // FK → devices
  configVersion:  integer("config_version").notNull(),
  configPayload:  jsonb("config_payload").$type<DeviceConfigPayload>().notNull(),
  deliveryStatus: varchar("delivery_status", { length: 20 }).notNull().default("pending"),
  // delivery_status: pending | delivered | acknowledged | delivery_failed
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
});

// ── Types ─────────────────────────────────────────────────────────────────

/** Configuration payload pushed to devices via heartbeat response. */
export interface DeviceConfigPayload {
  heartbeatIntervalMs?: number;
  displayLanguage?: string;
  displayBrightness?: number;
  printerDensity?: number;
  cameraResolution?: string;
  firmwareUrl?: string;
  firmwareChecksum?: string;
  custom?: Record<string, string>;
}

export type DeviceRow = typeof devices.$inferSelect;
export type DeviceInsert = typeof devices.$inferInsert;
export type DeviceAuditLogRow = typeof deviceAuditLog.$inferSelect;
export type DeviceAuditLogInsert = typeof deviceAuditLog.$inferInsert;
export type DeviceConfigRow = typeof deviceConfigs.$inferSelect;
export type DeviceConfigInsert = typeof deviceConfigs.$inferInsert;

export const schema = { devices, deviceAuditLog, deviceConfigs };
