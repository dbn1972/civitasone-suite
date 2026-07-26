import { pgSchema, uuid, varchar, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * CAP-060 — integration observability / DLQ replay (admin-service).
 * Mirrors migration 0022_integration_ops_dlq.sql. Schema `integration_ops`.
 */
export const integrationOpsSchema = pgSchema("integration_ops");

export const deadLetter = integrationOpsSchema.table("dead_letter", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  topic:         varchar("topic", { length: 120 }).notNull(),
  messageId:     varchar("message_id", { length: 120 }),
  sourceService: varchar("source_service", { length: 64 }),
  correlationId: varchar("correlation_id", { length: 120 }),
  payload:       jsonb("payload").notNull().default({}),
  error:         text("error"),
  retryCount:    integer("retry_count").notNull().default(0),
  status:        varchar("status", { length: 16 }).notNull().default("pending"),
  firstFailedAt: timestamp("first_failed_at", { withTimezone: true }).notNull().defaultNow(),
  lastErrorAt:   timestamp("last_error_at", { withTimezone: true }).notNull().defaultNow(),
  requeuedAt:    timestamp("requeued_at", { withTimezone: true }),
  discardedAt:   timestamp("discarded_at", { withTimezone: true }),
  actionedBy:    uuid("actioned_by"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:       integer("version").notNull().default(1),
});

export const deadLetterAction = integrationOpsSchema.table("dead_letter_action", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  deadLetterId: uuid("dead_letter_id").notNull(),
  action:       varchar("action", { length: 16 }).notNull(),
  note:         text("note"),
  actorId:      uuid("actor_id"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeadLetterRow          = typeof deadLetter.$inferSelect;
export type DeadLetterInsert       = typeof deadLetter.$inferInsert;
export type DeadLetterActionRow    = typeof deadLetterAction.$inferSelect;
export type DeadLetterActionInsert = typeof deadLetterAction.$inferInsert;

export const schema = { deadLetter, deadLetterAction };
