/**
 * VC-integration module — Drizzle table definitions (owns the `meeting.vc_sessions` table).
 *
 * Mirrors migrations/0001_meeting_core.sql `meeting.vc_sessions` column-for-column (types,
 * nullability, defaults). The migration is the source of truth for the DDL; this file is the
 * typed application-layer view of it consumed by the vc-integration consumer/repo layers
 * (task 14.2).
 *
 * Module isolation (steering L2): each module owns its PG schema objects. `meetingSchema`
 * is a reference to the shared `meeting` PostgreSQL schema — calling `pgSchema("meeting")`
 * here produces the same schema binding used by sibling modules, without a cross-module
 * import dependency.
 *
 * `meetingId` is modelled as a plain `uuid` column; the referential-integrity FK
 * (`vc_sessions.meeting_id → meetings.id`) is enforced at the database level by the
 * migration (the `meetings` table is owned by the meeting-core module), so no Drizzle-level
 * cross-module table reference is needed here.
 *
 * _Requirements: 13.1, 13.2, 13.5, 13.6, 13.7_
 */
import { pgSchema, uuid, text, varchar, timestamp, integer } from "drizzle-orm/pg-core";

/** The `meeting` PostgreSQL schema (RLS-enabled, tenant-isolated per migration). */
export const meetingSchema = pgSchema("meeting");

/**
 * `meeting.vc_sessions` — one video-conference session provisioned for a meeting.
 *
 * `provider` records which platform actually served the session (`nic_vc`, `ms_teams`,
 * `google_meet`, `zoom`, `webrtc`). On a fallback switch (Req 13.5) the persisted `provider`
 * is the one that succeeded, not the originally-requested one, so the row is an accurate
 * record of where participants actually joined.
 *
 * `status` lifecycle: `created` → `active` (recording/session live) → `ended`, or `failed`
 * (with `failureReason`) when every configured provider was unavailable (Req 13.5/13.6).
 *
 * `externalId` is the provider-side session identifier used by all subsequent adapter calls
 * (getJoinLink, getParticipants, start/stopRecording, endSession — Req 13.7).
 */
export const vcSessions = meetingSchema.table("vc_sessions", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  meetingId:           uuid("meeting_id").notNull(),
  provider:            varchar("provider", { length: 16 }).notNull(),
  externalId:          text("external_id"),
  joinUrl:             text("join_url"),
  dialInNumber:        text("dial_in_number"),
  meetingPin:          text("meeting_pin"),
  recordingUrl:        text("recording_url"),
  recordingStorageKey: text("recording_storage_key"),
  status:              varchar("status", { length: 16 }).notNull().default("created"),
  startedAt:           timestamp("started_at", { withTimezone: true }),
  endedAt:             timestamp("ended_at", { withTimezone: true }),
  failureReason:       text("failure_reason"),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid("created_by").notNull(),
  updatedBy:           uuid("updated_by").notNull(),
  version:             integer("version").notNull().default(1),
});

/** Drizzle schema map fragment — merged into shared/db.ts `schema` as this module lands. */
export const vcIntegrationModule = { vcSessions };

/** Row types inferred from the table for repo/consumer/query layers. */
export type VcSessionRow = typeof vcSessions.$inferSelect;
export type VcSessionInsert = typeof vcSessions.$inferInsert;
