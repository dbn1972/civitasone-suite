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
  eventType: varchar("event_type", { length: 200 }).notNull(),
  payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
  statusCode: integer("status_code"),
  responseBody: text("response_body"),
  attempt: integer("attempt").notNull().default(1),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WebhookRow = typeof webhooks.$inferSelect;
export type WebhookInsert = typeof webhooks.$inferInsert;
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;

export const schema = { webhooks, webhookDeliveries };
