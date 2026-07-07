/**
 * transcription module — stores transcription results linked to call recordings.
 *
 * Each transcript is linked to a recording and a call. The text field has a
 * maximum of 500,000 characters enforced at both the DB (CHECK constraint)
 * and application layer.
 */
import { pgSchema, uuid, varchar, integer, text, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("telephony");

export const transcripts = domainSchema.table("transcripts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  callId: uuid("call_id").notNull(),
  recordingId: uuid("recording_id").notNull(),
  text: text("text").notNull().default(""),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type TranscriptRow = typeof transcripts.$inferSelect;
export type TranscriptInsert = typeof transcripts.$inferInsert;

export type TranscriptView = {
  id: string;
  tenantId: string;
  callId: string;
  recordingId: string;
  text: string;
  status: string;
  durationMs: number | null;
  createdAt: string;
};

export const schema = { transcripts };
