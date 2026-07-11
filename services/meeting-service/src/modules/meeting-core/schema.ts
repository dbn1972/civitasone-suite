/**
 * meeting-core — Drizzle table definitions.
 *
 * These tables live in the `meeting` PostgreSQL schema and mirror, column-for-column,
 * the DDL created by migrations/0001_meeting_core.sql. Column types are chosen to
 * match the migration exactly (uuid, varchar(N), text, timestamptz, jsonb, bigint,
 * integer version) so Drizzle's view of the schema never drifts from the database.
 *
 * Scope (task 3.1): the four meeting-core tables —
 *   meetings, meeting_types, meeting_series, meeting_state_transitions.
 * Sibling modules (committee, agenda, …) own their own schema.ts files; the shared
 * db.ts merges every module's exported tables into one Drizzle client.
 *
 * Standard entity columns on the mutable tables: id (uuid PK), tenant_id, created_at,
 * updated_at, created_by, updated_by, version (optimistic-locking int). The
 * append-only state-transition log intentionally omits the mutable-entity columns.
 */
import {
  pgSchema, uuid, text, integer, boolean, date, timestamp, jsonb, varchar,
} from "drizzle-orm/pg-core";

/** The `meeting` PG schema — every meeting-service table is namespaced under it. */
export const meetingSchema = pgSchema("meeting");

// ─── Meetings ────────────────────────────────────────────────────────────────

export const meetings = meetingSchema.table("meetings", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  tenantId:             uuid("tenant_id").notNull(),
  type:                 varchar("type", { length: 32 }).notNull(),
  title:                text("title").notNull(),
  description:          text("description"),
  status:               varchar("status", { length: 32 }).notNull().default("draft"),
  committeeId:          uuid("committee_id"),
  chairpersonId:        uuid("chairperson_id"),
  secretaryId:          uuid("secretary_id"),
  convenerId:           uuid("convener_id"),
  scheduledAt:          timestamp("scheduled_at", { withTimezone: true }),
  actualStartAt:        timestamp("actual_start_at", { withTimezone: true }),
  actualEndAt:          timestamp("actual_end_at", { withTimezone: true }),
  durationMinutes:      integer("duration_minutes").notNull().default(60),
  venue:                text("venue"),
  vcEnabled:            boolean("vc_enabled").notNull().default(false),
  vcLink:               text("vc_link"),
  confidentialityLevel: varchar("confidentiality_level", { length: 16 }).notNull().default("internal"),
  parentMeetingId:      uuid("parent_meeting_id"),
  seriesId:             uuid("series_id"),
  quorumEstablished:    boolean("quorum_established").notNull().default(false),
  quorumEstablishedAt:  timestamp("quorum_established_at", { withTimezone: true }),
  adjournmentReason:    text("adjournment_reason"),
  nextMeetingDate:      timestamp("next_meeting_date", { withTimezone: true }),
  fileReference:        text("file_reference"),
  meetingNumber:        text("meeting_number"),
  financialYear:        varchar("financial_year", { length: 7 }),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:            uuid("created_by").notNull(),
  updatedBy:            uuid("updated_by").notNull(),
  version:             integer("version").notNull().default(1),
});

// ─── Meeting Types ───────────────────────────────────────────────────────────

export const meetingTypes = meetingSchema.table("meeting_types", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  code:           varchar("code", { length: 32 }).notNull(),
  name:           text("name").notNull(),
  description:    text("description"),
  templateConfig: jsonb("template_config"),
  isStatutory:    boolean("is_statutory").notNull().default(false),
  frequency:      varchar("frequency", { length: 16 }),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

// ─── Meeting Series ──────────────────────────────────────────────────────────

export const meetingSeries = meetingSchema.table("meeting_series", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  committeeId:      uuid("committee_id").notNull(),
  pattern:          varchar("pattern", { length: 16 }).notNull(),
  dayOfWeek:        integer("day_of_week"),
  dayOfMonth:       integer("day_of_month"),
  timeOfDay:        varchar("time_of_day", { length: 5 }),
  durationMinutes:  integer("duration_minutes").notNull().default(60),
  startDate:        date("start_date").notNull(),
  endDate:          date("end_date"),
  nextInstanceDate: date("next_instance_date"),
  isActive:         boolean("is_active").notNull().default(true),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

// ─── Meeting State Transitions (append-only audit log) ─────────────────────────

export const meetingStateTransitions = meetingSchema.table("meeting_state_transitions", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  meetingId:      uuid("meeting_id").notNull(),
  fromState:      varchar("from_state", { length: 32 }).notNull(),
  toState:        varchar("to_state", { length: 32 }).notNull(),
  reason:         text("reason"),
  actorId:        uuid("actor_id").notNull(),
  transitionedAt: timestamp("transitioned_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Inferred row/insert types ─────────────────────────────────────────────────

export type MeetingRow    = typeof meetings.$inferSelect;
export type MeetingInsert = typeof meetings.$inferInsert;

export type MeetingTypeRow    = typeof meetingTypes.$inferSelect;
export type MeetingTypeInsert = typeof meetingTypes.$inferInsert;

export type MeetingSeriesRow    = typeof meetingSeries.$inferSelect;
export type MeetingSeriesInsert = typeof meetingSeries.$inferInsert;

export type MeetingStateTransitionRow    = typeof meetingStateTransitions.$inferSelect;
export type MeetingStateTransitionInsert = typeof meetingStateTransitions.$inferInsert;

/** Merged export consumed by shared/db.ts to assemble the full Drizzle schema. */
export const schema = {
  meetings,
  meetingTypes,
  meetingSeries,
  meetingStateTransitions,
};
