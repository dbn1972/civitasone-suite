import { pgSchema, uuid, varchar, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * V4-G-07: the original send content a retry needs to reproduce the first
 * attempt (merge fields, marketing/consent classification, inline body).
 */
export type RetryPayload = {
  variables?: Record<string, string>;
  eventType?: string;
  category?: "transactional" | "marketing";
  campaignId?: string;
  subject?: string;
  body?: string;
};

export const deliveriesSchema = pgSchema("deliveries");

export const notificationDeliveries = deliveriesSchema.table("deliveries", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  templateId: uuid("template_id").notNull(),
  recipient:  varchar("recipient", { length: 254 }).notNull(),
  recipientId: uuid("recipient_id"),
  channel:    varchar("channel", { length: 32 }).notNull(),
  status:       varchar("status", { length: 24 }).notNull().default("queued"),
  sentAt:       timestamp("sent_at", { withTimezone: true }),
  error:        text("error"),
  retryCount:   integer("retry_count").notNull().default(0),
  nextRetryAt:  timestamp("next_retry_at", { withTimezone: true }),
  errorDetail:  text("error_detail"),
  /** V4-G-07: original send content, set when a retry is scheduled. */
  retryPayload: jsonb("retry_payload").$type<RetryPayload>(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

export type DeliveryRow    = typeof notificationDeliveries.$inferSelect;
export type DeliveryInsert = typeof notificationDeliveries.$inferInsert;

export const deliveriesModuleSchema = { notificationDeliveries };
