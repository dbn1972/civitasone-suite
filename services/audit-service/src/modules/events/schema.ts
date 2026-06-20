import { pgSchema, uuid, varchar, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const eventsSchema = pgSchema("events");

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
});

export type AuditEventRow    = typeof auditEvents.$inferSelect;
export type AuditEventInsert = typeof auditEvents.$inferInsert;

export const eventsModuleSchema = { auditEvents };
