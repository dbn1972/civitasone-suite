import { pgSchema, uuid, varchar, text, jsonb, timestamp, inet } from "drizzle-orm/pg-core";

export const eventsSchema = pgSchema("events");

/**
 * Append-only audit event log.
 * CERT-In requirement: no DELETE or UPDATE routes exist for this table.
 * Retention: events must be kept for >= 180 days (enforced by retainUntil + pg_partman or policy).
 */
export const auditEvents = eventsSchema.table("events", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  type:          varchar("type", { length: 128 }).notNull(),
  actor:         jsonb("actor").$type<Record<string, unknown>>().notNull().default({}),
  target:        varchar("target", { length: 256 }),
  payload:       jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  severity:      varchar("severity", { length: 16 }).notNull().default("info"),
  prevHash:      varchar("prev_hash", { length: 64 }),
  eventHash:     varchar("event_hash", { length: 64 }),
  correlationId: varchar("correlation_id", { length: 64 }),
  occurredAt:    timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  ipAddress:     varchar("ip_address", { length: 45 }),
  userAgent:     varchar("user_agent", { length: 512 }),
  oldValue:      jsonb("old_value").$type<Record<string, unknown>>(),
  newValue:      jsonb("new_value").$type<Record<string, unknown>>(),
  retainUntil:   timestamp("retain_until", { withTimezone: true }),
});

export type AuditEventRow    = typeof auditEvents.$inferSelect;
export type AuditEventInsert = typeof auditEvents.$inferInsert;

export const eventsModuleSchema = { auditEvents };
