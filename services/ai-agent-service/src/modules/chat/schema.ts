import { pgSchema, uuid, varchar, integer, timestamp, text } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("ai_agent");

export const conversations = domainSchema.table("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  channelId: uuid("channel_id").notNull(),
  profileId: uuid("profile_id").notNull(),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  language: varchar("language", { length: 8 }).notNull().default("en"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ConversationRow = typeof conversations.$inferSelect;
export type ConversationInsert = typeof conversations.$inferInsert;

/**
 * Conversation transcript. `content` is stored guardrail-sanitised (PII redacted)
 * — DPDP Act 2023: raw personal data is never persisted in the transcript.
 */
export const messages = domainSchema.table("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  conversationId: uuid("conversation_id").notNull(),
  role: varchar("role", { length: 16 }).notNull(),
  content: text("content").notNull(),
  tokens: integer("tokens"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type MessageRow = typeof messages.$inferSelect;
export type MessageInsert = typeof messages.$inferInsert;

export const schema = { conversations, messages };
