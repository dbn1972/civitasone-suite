/**
 * webhooks module — Drizzle schema. Lives in its OWN Postgres schema `webhooks`.
 * Outbound webhooks with HMAC-SHA256 signature verification.
 */
import { pgSchema, uuid, varchar, text, boolean, jsonb, integer, timestamp } from "drizzle-orm/pg-core";

export const webhooksSchema = pgSchema("webhooks");

export const webhooks = webhooksSchema.table("webhooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  url: text("url").notNull(),
  events: jsonb("events").notNull().$type<string[]>().default([]),
  secret: text("secret").notNull(), // HMAC key
  // CAP-054 secret rotation: previous secret honoured during grace window.
  previousSecret: text("previous_secret"),
  secretRotatedAt: timestamp("secret_rotated_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  description: varchar("description", { length: 500 }).default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const webhookDeliveries = webhooksSchema.table("webhook_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  webhookId: uuid("webhook_id").notNull(),
  // CAP-054: tenant scope (FORCE RLS) + dedup + lifecycle + replay.
  tenantId: uuid("tenant_id"),
  eventId: uuid("event_id"),
  eventType: varchar("event_type", { length: 200 }).notNull(),
  payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
  status: varchar("status", { length: 20 }).notNull().default("delivered"),
  statusCode: integer("status_code"),
  responseBody: text("response_body"),
  signature: text("signature"),
  lastError: text("last_error"),
  attempt: integer("attempt").notNull().default(1),
  maxAttempts: integer("max_attempts").notNull().default(5),
  replayOf: uuid("replay_of"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** CAP-054 maker-checker HMAC secret rotation requests. */
export const secretRotations = webhooksSchema.table("secret_rotations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  webhookId: uuid("webhook_id").notNull(),
  newSecret: text("new_secret").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  reason: text("reason"),
  requestedBy: uuid("requested_by").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  correlationId: varchar("correlation_id", { length: 64 }),
});

export type WebhookRow = typeof webhooks.$inferSelect;
export type WebhookInsert = typeof webhooks.$inferInsert;
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
export type SecretRotationRow = typeof secretRotations.$inferSelect;

export const schema = { webhooks, webhookDeliveries, secretRotations };
