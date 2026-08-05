/**
 * CH-07 — Inbound review queue table for unmatched/ambiguous contacts.
 */
import { pgSchema, uuid, varchar, text, timestamp } from "drizzle-orm/pg-core";
import { jsonb } from "drizzle-orm/pg-core";

export const notificationSchema = pgSchema("notification");

export const inboundReviewQueue = notificationSchema.table("inbound_review_queue", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  channel:          varchar("channel", { length: 16 }).notNull(),
  senderIdentifier: varchar("sender_identifier", { length: 256 }).notNull(),
  messageContent:   text("message_content"),
  metadata:         jsonb("metadata").default({}),
  status:           varchar("status", { length: 16 }).notNull().default("pending"),
  reason:           varchar("reason", { length: 64 }),
  linkedContactId:  uuid("linked_contact_id"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt:       timestamp("resolved_at", { withTimezone: true }),
  resolvedBy:       uuid("resolved_by"),
});

export type InboundReviewQueueRow = typeof inboundReviewQueue.$inferSelect;
export type InboundReviewQueueInsert = typeof inboundReviewQueue.$inferInsert;

export const reviewQueueModuleSchema = { inboundReviewQueue };
