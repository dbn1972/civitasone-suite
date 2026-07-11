/**
 * visitor-service: turnstile-control Drizzle schema.
 *
 * Defines the `visitor.passage_events` and `visitor.device_commands` tables
 * for the turnstile/barrier hardware integration module.
 *
 * Requirements validated: 7.1, 7.2, 7.9
 */
import {
  pgSchema,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

export const visitorSchema = pgSchema("visitor");

// ── visitor.passage_events ────────────────────────────────────────────────
export const passageEvents = visitorSchema.table("passage_events", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  deviceId:        uuid("device_id").notNull(),    // FK → devices
  gateId:          uuid("gate_id").notNull(),       // FK → visitor.gates
  passId:          uuid("pass_id").notNull(),       // FK → digital_passes
  direction:       varchar("direction", { length: 4 }).notNull(),
  // direction: in | out (CHECK constraint in migration)
  eventType:       varchar("event_type", { length: 16 }).notNull().default("passage"),
  // event_type: passage | abandoned | tailgating
  passageCount:    integer("passage_count").notNull().default(1),
  offlineRecorded: boolean("offline_recorded").notNull().default(false),
  eventTimestamp:  timestamp("event_timestamp", { withTimezone: true }).notNull(),
  syncedAt:        timestamp("synced_at", { withTimezone: true }),
  syncStatus:      varchar("sync_status", { length: 24 }).notNull().default("realtime"),
  // sync_status: realtime | offline_synced | retroactively_invalid
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── visitor.device_commands ───────────────────────────────────────────────
export const deviceCommands = visitorSchema.table("device_commands", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  deviceId:        uuid("device_id").notNull(),    // FK → devices
  commandType:     varchar("command_type", { length: 20 }).notNull(),
  // command_type: open | close | emergency_open | config_push
  payload:         jsonb("payload"),
  status:          varchar("status", { length: 16 }).notNull().default("queued"),
  // status: queued | delivered | acknowledged | expired
  correlationId:   uuid("correlation_id"),
  expiresAt:       timestamp("expires_at", { withTimezone: true }),
  deliveredAt:     timestamp("delivered_at", { withTimezone: true }),
  acknowledgedAt:  timestamp("acknowledged_at", { withTimezone: true }),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Types ─────────────────────────────────────────────────────────────────

export type PassageEventRow = typeof passageEvents.$inferSelect;
export type PassageEventInsert = typeof passageEvents.$inferInsert;
export type DeviceCommandRow = typeof deviceCommands.$inferSelect;
export type DeviceCommandInsert = typeof deviceCommands.$inferInsert;

export const schema = { passageEvents, deviceCommands };
