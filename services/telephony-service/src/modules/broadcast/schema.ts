/**
 * CH-11 — Voice broadcast tables (telephony schema).
 */
import { pgSchema, uuid, varchar, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("telephony");

export const voiceBroadcasts = domainSchema.table("voice_broadcasts", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  name:           varchar("name", { length: 256 }).notNull(),
  flowId:         uuid("flow_id"),
  audioUrl:       varchar("audio_url", { length: 512 }),
  ttsText:        text("tts_text"),
  status:         varchar("status", { length: 16 }).notNull().default("draft"),
  scheduledAt:    timestamp("scheduled_at", { withTimezone: true }),
  startedAt:      timestamp("started_at", { withTimezone: true }),
  completedAt:    timestamp("completed_at", { withTimezone: true }),
  recipientCount: integer("recipient_count").notNull().default(0),
  answeredCount:  integer("answered_count").notNull().default(0),
  failedCount:    integer("failed_count").notNull().default(0),
  retryPolicy:    jsonb("retry_policy").default({ max_attempts: 3, interval_seconds: 300 }),
  createdBy:      uuid("created_by").notNull(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export const broadcastRecipients = domainSchema.table("broadcast_recipients", {
  id:             uuid("id").primaryKey().defaultRandom(),
  broadcastId:    uuid("broadcast_id").notNull(),
  contactId:      uuid("contact_id").notNull(),
  status:         varchar("status", { length: 16 }).notNull().default("pending"),
  attempts:       integer("attempts").notNull().default(0),
  lastAttemptAt:  timestamp("last_attempt_at", { withTimezone: true }),
  outcome:        jsonb("outcome").default({}),
  tenantId:       uuid("tenant_id").notNull(),
});

export type VoiceBroadcastRow = typeof voiceBroadcasts.$inferSelect;
export type VoiceBroadcastInsert = typeof voiceBroadcasts.$inferInsert;
export type BroadcastRecipientRow = typeof broadcastRecipients.$inferSelect;
export type BroadcastRecipientInsert = typeof broadcastRecipients.$inferInsert;

export const schema = { voiceBroadcasts, broadcastRecipients };
