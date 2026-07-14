/**
 * Voting module — Drizzle table definitions (owns the `meeting.votes` table).
 *
 * Mirrors migrations/0001_meeting_core.sql `meeting.votes` column-for-column (types,
 * nullability, defaults). The migration is the source of truth for the DDL; this file
 * is the typed application-layer view of it.
 *
 * Module isolation (steering L2): each module owns its PG schema objects. `meetingSchema`
 * is a reference to the shared `meeting` PostgreSQL schema — calling `pgSchema("meeting")`
 * here produces the same schema binding used by sibling modules, without a cross-module
 * import dependency.
 *
 * Ownership boundary: the `meeting.resolutions` table is owned by the decision module
 * (see ../decision/schema.ts). This module owns ONLY `meeting.votes`. `resolutionId` is
 * modelled as a plain `uuid` column here; the referential-integrity FK
 * (`votes.resolution_id → resolutions.id`) and the `UNIQUE(resolution_id, member_id)`
 * duplicate-vote guard (P17) are enforced at the database level by the migration, so no
 * Drizzle-level cross-module table reference is needed.
 *
 * _Requirements: 11.1, 11.2, 11.3, 11.4_
 */
import { pgSchema, uuid, text, boolean, integer, timestamp, varchar } from "drizzle-orm/pg-core";

/** The `meeting` PostgreSQL schema (RLS-enabled, tenant-isolated per migration). */
export const meetingSchema = pgSchema("meeting");

/**
 * `meeting.votes` — one member's recorded position on a single resolution.
 *
 * Duplicate-vote prevention (Req 11.3, P17): the migration declares a UNIQUE index on
 * `(resolution_id, member_id)`, so a member can hold at most one vote per resolution. The
 * domain layer additionally pre-checks this (see domain.ts `assertNoDuplicateVote`) to
 * surface a clean 409 (`MEETING_DUPLICATE_VOTE`) rather than a raw constraint violation.
 *
 * Vote-count consistency (Req 11.4, P14): `position` is constrained to
 * for | against | abstain, so summing the three position tallies over the votes of a
 * resolution always equals the row count for that resolution.
 *
 * `isCirculation` distinguishes asynchronous circulation-resolution votes (Req 12) cast
 * outside a live meeting from in-meeting roll_call / electronic_poll votes (Req 11).
 */
export const votes = meetingSchema.table("votes", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  resolutionId:  uuid("resolution_id").notNull(),
  memberId:      uuid("member_id").notNull(),
  position:      varchar("position", { length: 8 }).notNull(),
  weight:        integer("weight").notNull().default(1),
  reason:        text("reason"),
  votedAt:       timestamp("voted_at", { withTimezone: true }).notNull().defaultNow(),
  isCirculation: boolean("is_circulation").notNull().default(false),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * `meeting.recusals` — a member's recorded conflict-of-interest recusal on a single
 * motion (resolution). A recused member CANNOT cast a vote on that motion (rejected),
 * is EXCLUDED from the motion's tally (they never cast) and from the quorum-for-that-
 * item denominator, and the recusal is recorded here for the vote record / minutes.
 * `registerRef` optionally links the declaration to the member's register-of-interests
 * entry. One recusal per (resolution, member) — enforced by the migration's UNIQUE index.
 *
 * _Requirements: statutory conflict-of-interest (recusal) completeness._
 */
export const recusals = meetingSchema.table("recusals", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  resolutionId: uuid("resolution_id").notNull(),
  meetingId:    uuid("meeting_id").notNull(),
  memberId:     uuid("member_id").notNull(),
  agendaItemId: uuid("agenda_item_id"),
  reason:       text("reason").notNull(),
  registerRef:  text("register_ref"),
  recordedBy:   uuid("recorded_by").notNull(),
  recordedAt:   timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RecusalRow = typeof recusals.$inferSelect;
export type RecusalInsert = typeof recusals.$inferInsert;

/** Drizzle schema map fragment — merged into shared/db.ts `schema` as this module lands. */
export const votingModule = { votes, recusals };

/** Row types inferred from the table for repo/consumer/query layers. */
export type VoteRow = typeof votes.$inferSelect;
export type VoteInsert = typeof votes.$inferInsert;
