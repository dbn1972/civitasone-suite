/**
 * Attendance module — Drizzle table definitions (owns the `meeting.attendance_records` table).
 *
 * Mirrors migrations/0001_meeting_core.sql `meeting.attendance_records` column-for-column
 * (types, nullability, defaults). The migration is the source of truth for the DDL; this
 * file is the typed application-layer view of it.
 *
 * Module isolation (steering L2): each module owns its PG schema objects. `meetingSchema`
 * is a reference to the shared `meeting` PostgreSQL schema — calling `pgSchema("meeting")`
 * here produces the same schema binding used by sibling modules, without a cross-module
 * import dependency.
 *
 * An Attendance_Record is a verified record of participant presence captured via QR scan,
 * biometric, mobile geolocation, VC presence, or manual marking (Req 6.1). One record per
 * (meeting, participant) — enforced by the unique index `idx_attendance_unique` in the
 * migration. `geo_latitude`/`geo_longitude`/`device_id` are non-PII capture provenance kept
 * as free text (matching the migration); no `encryptedText()` is used here.
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
 */
import { pgSchema, uuid, text, integer, varchar, timestamp } from "drizzle-orm/pg-core";

/** The `meeting` PostgreSQL schema (RLS-enabled, tenant-isolated per migration). */
export const meetingSchema = pgSchema("meeting");

/**
 * `meeting.attendance_records` — one verified presence record per participant per meeting.
 *
 * `method` ∈ qr | biometric | geo | vc | manual (capture channel, Req 6.1).
 * `mode`   ∈ in_person | vc (physical vs video-conference presence).
 * `status` ∈ present | absent | joined_late | left_early | attending_via_vc (Req 6.3).
 * `check_in_at` after `meeting.actual_start_at` flags a joined_late arrival (Req 6.5).
 */
export const attendanceRecords = meetingSchema.table("attendance_records", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  meetingId:     uuid("meeting_id").notNull(),
  participantId: uuid("participant_id").notNull(),
  method:        varchar("method", { length: 16 }).notNull(),
  checkInAt:     timestamp("check_in_at", { withTimezone: true }).notNull(),
  checkOutAt:    timestamp("check_out_at", { withTimezone: true }),
  mode:          varchar("mode", { length: 16 }).notNull().default("in_person"),
  status:        varchar("status", { length: 16 }).notNull().default("present"),
  geoLatitude:   text("geo_latitude"),
  geoLongitude:  text("geo_longitude"),
  deviceId:      text("device_id"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

/** Drizzle schema map fragment — merged into shared/db.ts `schema` as this module lands. */
export const attendanceModule = { attendanceRecords };

/** Row types inferred from the table for repo/consumer/query layers. */
export type AttendanceRecordRow = typeof attendanceRecords.$inferSelect;
export type AttendanceRecordInsert = typeof attendanceRecords.$inferInsert;
