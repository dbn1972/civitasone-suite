/**
 * Minutes module — Drizzle table definitions (owns `meeting.minutes` and
 * `meeting.minutes_versions`).
 *
 * Mirrors migrations/0001_meeting_core.sql `meeting.minutes` and `meeting.minutes_versions`
 * column-for-column (types, nullability, defaults). The migration is the source of truth
 * for the DDL; this file is the typed application-layer view of it.
 *
 * Module isolation (steering L2): each module owns its PG schema objects. `meetingSchema`
 * is a reference to the shared `meeting` PostgreSQL schema — calling `pgSchema("meeting")`
 * here produces the same schema binding used by sibling modules, without a cross-module
 * import dependency.
 *
 * Integrity model (Req 8.5, CERT-In): every approved minutes document carries a
 * `hash_current` = SHA-256 of its content (P24) and a `hash_previous` linking it to the
 * prior approved minutes of the same committee (P23), forming a tamper-evident chain.
 * The `dsc_*` columns hold the PKCS#7 detached signature applied at approval/sign time.
 *
 * _Requirements: 7.1, 7.5, 7.8, 8.1, 8.5_
 */
import { pgSchema, uuid, text, integer, varchar, boolean, timestamp } from "drizzle-orm/pg-core";

/** The `meeting` PostgreSQL schema (RLS-enabled, tenant-isolated per migration). */
export const meetingSchema = pgSchema("meeting");

/**
 * `meeting.minutes` — the official record of a meeting's proceedings.
 *
 * Lifecycle (Req 7.1, 7.5, 7.6): `status` ∈ draft | submitted | approved | signed | circulated.
 * A draft is created when the meeting reaches `minutes_pending`; on chairperson approval the
 * content is locked against further edits (see domain.ts `isMinutesLocked` / `assertMinutesEditable`).
 *
 * Templating (Req 7.2): `templateType` ∈ verbatim | summary | resolution_only selects how the
 * initial draft is rendered (see domain.ts `renderMinutesTemplate`).
 *
 * Versioning (Req 7.8): `currentVersion` is the live draft version; each revision snapshots the
 * prior content into `meeting.minutes_versions` for diff tracking.
 */
export const minutes = meetingSchema.table("minutes", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  tenantId:           uuid("tenant_id").notNull(),
  meetingId:          uuid("meeting_id").notNull(),
  templateType:       varchar("template_type", { length: 16 }).notNull().default("summary"),
  content:            text("content").notNull(),
  status:             varchar("status", { length: 16 }).notNull().default("draft"),
  currentVersion:     integer("current_version").notNull().default(1),
  approvedBy:         uuid("approved_by"),
  approvedAt:         timestamp("approved_at", { withTimezone: true }),
  dscSignature:       text("dsc_signature"),
  dscSignerName:      text("dsc_signer_name"),
  dscSignedAt:        timestamp("dsc_signed_at", { withTimezone: true }),
  hashPrevious:       varchar("hash_previous", { length: 64 }),
  hashCurrent:        varchar("hash_current", { length: 64 }),
  storageKey:         text("storage_key"),
  submissionDeadline: timestamp("submission_deadline", { withTimezone: true }),
  aiGenerated:        boolean("ai_generated").notNull().default(false),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:          uuid("created_by").notNull(),
  updatedBy:          uuid("updated_by").notNull(),
  version:            integer("version").notNull().default(1),
});

/**
 * `meeting.minutes_versions` — immutable snapshot of a minutes draft at a point in time.
 *
 * Every accepted content revision (and every rejection-driven re-open) appends a row here,
 * giving a full version history with diff tracking (Req 7.8, see domain.ts `diffMinutes`).
 * Rows are append-only; they are never mutated or deleted.
 */
export const minutesVersions = meetingSchema.table("minutes_versions", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  minutesId:  uuid("minutes_id").notNull(),
  versionNum: integer("version_num").notNull(),
  content:    text("content").notNull(),
  changedBy:  uuid("changed_by").notNull(),
  changeNote: text("change_note"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Drizzle schema map fragment — merged into shared/db.ts `schema` as this module lands. */
export const minutesModule = { minutes, minutesVersions };

/** Row types inferred from the tables for repo/consumer/query layers. */
export type MinutesRow = typeof minutes.$inferSelect;
export type MinutesInsert = typeof minutes.$inferInsert;
export type MinutesVersionRow = typeof minutesVersions.$inferSelect;
export type MinutesVersionInsert = typeof minutesVersions.$inferInsert;
