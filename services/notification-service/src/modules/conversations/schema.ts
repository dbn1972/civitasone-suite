/**
 * G5 — Conversation Thread Model.
 * Tables: notification.conversations, notification.conversation_messages
 */
import { pgSchema, uuid, varchar, text, integer, timestamp } from "drizzle-orm/pg-core";

export const conversationSchema = pgSchema("notification");

export const conversations = conversationSchema.table("conversations", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  channel:          varchar("channel", { length: 16 }).notNull(),
  contactId:        uuid("contact_id").notNull(),
  providerThreadId: varchar("provider_thread_id", { length: 256 }),
  subject:          varchar("subject", { length: 500 }),
  status:           varchar("status", { length: 16 }).notNull().default("open"),
  startedAt:        timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt:    timestamp("last_message_at", { withTimezone: true }),
  messageCount:     integer("message_count").notNull().default(0),
  closedAt:         timestamp("closed_at", { withTimezone: true }),
  assignedTo:       uuid("assigned_to"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

export const conversationMessages = conversationSchema.table("conversation_messages", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  conversationId:    uuid("conversation_id").notNull(),
  direction:         varchar("direction", { length: 8 }).notNull(),
  contentType:       varchar("content_type", { length: 16 }).notNull().default("text"),
  content:           text("content"),
  providerMessageId: varchar("provider_message_id", { length: 256 }),
  status:            varchar("status", { length: 16 }).notNull().default("sent"),
  sentAt:            timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt:       timestamp("delivered_at", { withTimezone: true }),
  readAt:            timestamp("read_at", { withTimezone: true }),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
});

export type ConversationRow = typeof conversations.$inferSelect;
export type ConversationInsert = typeof conversations.$inferInsert;
export type ConversationMessageRow = typeof conversationMessages.$inferSelect;
export type ConversationMessageInsert = typeof conversationMessages.$inferInsert;

export const conversationsModuleSchema = { conversations, conversationMessages };
