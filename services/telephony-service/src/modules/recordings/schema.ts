/**
 * recordings module — recording metadata in schema `telephony`.
 *
 * Stores metadata about call recordings. The actual audio is stored in
 * S3/MinIO via `@civitasone/storage`. This table holds:
 * - recordingUrl: the carrier's original URL (temporary)
 * - storageKey: the S3 key after download+upload to our storage
 * - status: pending → stored → failed
 */
import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("telephony");

export const recordings = domainSchema.table("recordings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  callId: uuid("call_id").notNull(),
  recordingUrl: varchar("recording_url", { length: 512 }).notNull(),
  storageKey: varchar("storage_key", { length: 512 }),
  durationSec: integer("duration_sec"),
  format: varchar("format", { length: 16 }).notNull().default("mp3"),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type RecordingRow = typeof recordings.$inferSelect;
export type RecordingInsert = typeof recordings.$inferInsert;

export type RecordingView = {
  id: string;
  tenantId: string;
  callId: string;
  recordingUrl: string;
  storageKey: string | null;
  durationSec: number | null;
  format: string;
  status: string;
  createdAt: string;
};

export const schema = { recordings };
