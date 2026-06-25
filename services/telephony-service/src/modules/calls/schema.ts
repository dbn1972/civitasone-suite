/**
 * calls module — Drizzle schema in Postgres schema `telephony`.
 *
 * Phone numbers (caller/callee) are PII and are stored as AES-256-GCM ciphertext
 * via the `encryptedText` custom type (cleartext in app, ciphertext at rest).
 * A deterministic blind index over the caller number backs "all calls from this
 * number" lookups without decrypting. DB-per-service: no cross-service FKs —
 * grievance/helpdesk linkage stores the foreign ref id only.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text } from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";
import type { CallStatus, CallDirection, Disposition } from "./transitions.js";

export const domainSchema = pgSchema("telephony");

export type IvrHit = { menuKey: string; digit: string; at: string };

export const calls = domainSchema.table("calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  direction: varchar("direction", { length: 12 }).notNull().default("inbound"),
  // PII at rest: AES-256-GCM ciphertext (cleartext in app via customType).
  callerNumber: encryptedText("caller_number"),
  // Deterministic blind index over the normalized caller number (keyed HMAC).
  callerNumberIdx: text("caller_number_idx"),
  calleeNumber: encryptedText("callee_number"),
  status: varchar("status", { length: 16 }).notNull().default("queued"),
  disposition: varchar("disposition", { length: 32 }),
  queueId: uuid("queue_id"),
  agentId: uuid("agent_id"),
  // IVR menu hits captured during the call (menu key + DTMF digit + timestamp).
  ivrPath: jsonb("ivr_path").$type<IvrHit[]>().notNull().default([]),
  // Cross-domain linkage (grievance / helpdesk ticket) — ref id ONLY, no FK.
  linkedRefType: varchar("linked_ref_type", { length: 32 }),
  linkedRefId: uuid("linked_ref_id"),
  // Recording metadata only (never the audio payload).
  recordingId: varchar("recording_id", { length: 128 }),
  recordingUrl: varchar("recording_url", { length: 512 }),
  recordingDurationSec: integer("recording_duration_sec"),
  recordingFormat: varchar("recording_format", { length: 16 }),
  // Lifecycle timestamps drive SLA / abandonment metrics.
  queuedAt: timestamp("queued_at", { withTimezone: true }),
  ringingAt: timestamp("ringing_at", { withTimezone: true }),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  waitSeconds: integer("wait_seconds"),
  talkSeconds: integer("talk_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type CallRow = typeof calls.$inferSelect;
export type CallInsert = typeof calls.$inferInsert;

/** Internal projection — cleartext numbers (used by the write path + admin reads). */
export type CallView = {
  id: string;
  tenantId: string;
  direction: CallDirection;
  callerNumber: string | null;
  calleeNumber: string | null;
  status: CallStatus;
  disposition: Disposition | null;
  queueId: string | null;
  agentId: string | null;
  ivrPath: IvrHit[];
  linkedRefType: string | null;
  linkedRefId: string | null;
  recordingId: string | null;
  recordingUrl: string | null;
  recordingDurationSec: number | null;
  recordingFormat: string | null;
  queuedAt: string | null;
  ringingAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  waitSeconds: number | null;
  talkSeconds: number | null;
  version: number;
};

/**
 * API projection returned by list/detail endpoints. Phone numbers are MASKED
 * for non-admin callers (PII minimisation) — only the last 4 digits survive.
 */
export type CallSummary = {
  id: string;
  direction: CallDirection;
  callerNumber: string | null;
  calleeNumber: string | null;
  status: CallStatus;
  disposition: Disposition | null;
  queueId: string | null;
  agentId: string | null;
  linkedRefType: string | null;
  linkedRefId: string | null;
  hasRecording: boolean;
  waitSeconds: number | null;
  talkSeconds: number | null;
  slaAnswered: boolean | null;
  abandoned: boolean;
  startedAt: string | null;
  endedAt: string | null;
  version: number;
};

export const schema = { calls };
