/**
 * committee module — Drizzle table definitions (schema `meeting`).
 *
 * Mirrors migrations/0001_meeting_core.sql exactly for the three committee tables:
 *   meeting.committees, meeting.committee_members, meeting.committee_terms_history.
 *
 * Committees are formally-constituted governance bodies (Req 2.1) with a membership
 * roster (Req 2.2), a JSONB quorum rule (Req 2.3, see domain.ts `QuorumRule`), and a
 * versioned terms-of-reference history (Req 2.7). None of these columns hold PII, so
 * there is no `encryptedText()` usage here (unlike the participants table).
 *
 * Standard entity columns (id/tenant_id/created_at/updated_at/created_by/updated_by/
 * version) are present on committees + committee_members. committee_terms_history is an
 * append-only audit table and intentionally omits the updated_by/updated_at/version trio.
 */
import { pgSchema, uuid, text, integer, boolean, date, jsonb, varchar, timestamp } from "drizzle-orm/pg-core";

export const meetingSchema = pgSchema("meeting");

// ─── committees ──────────────────────────────────────────────────────────────

export const committees = meetingSchema.table("committees", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  name:                text("name").notNull(),
  code:                varchar("code", { length: 32 }),
  type:                varchar("type", { length: 32 }).notNull(),
  termsOfReference:    text("terms_of_reference"),
  termsOfReferenceUrl: text("terms_of_reference_url"),
  constitutionDate:    date("constitution_date").notNull(),
  tenureEnd:           date("tenure_end"),
  parentBodyId:        uuid("parent_body_id"),
  constitutingAuthority: text("constituting_authority"),
  quorumRule:          jsonb("quorum_rule").notNull(),
  votingRule:          varchar("voting_rule", { length: 32 }).notNull().default("simple_majority"),
  meetingFrequency:    varchar("meeting_frequency", { length: 16 }),
  statutoryBasis:      text("statutory_basis"),
  status:              varchar("status", { length: 16 }).notNull().default("active"),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid("created_by").notNull(),
  updatedBy:           uuid("updated_by").notNull(),
  version:             integer("version").notNull().default(1),
});

// ─── committee_members ─────────────────────────────────────────────────────────

export const committeeMembers = meetingSchema.table("committee_members", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  committeeId:         uuid("committee_id").notNull(),
  memberId:            uuid("member_id").notNull(),
  role:                varchar("role", { length: 32 }).notNull(),
  appointmentDate:     date("appointment_date").notNull(),
  tenureEnd:           date("tenure_end"),
  appointingAuthority: text("appointing_authority"),
  votingRight:         boolean("voting_right").notNull().default(true),
  voteWeight:          integer("vote_weight").notNull().default(1),
  status:              varchar("status", { length: 16 }).notNull().default("active"),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid("created_by").notNull(),
  updatedBy:           uuid("updated_by").notNull(),
  version:             integer("version").notNull().default(1),
});

// ─── committee_terms_history (append-only) ───────────────────────────────────────

export const committeeTermsHistory = meetingSchema.table("committee_terms_history", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  committeeId:      uuid("committee_id").notNull(),
  termsOfReference: text("terms_of_reference").notNull(),
  effectiveDate:    date("effective_date").notNull(),
  approvedBy:       uuid("approved_by").notNull(),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Inferred row/insert types ───────────────────────────────────────────────

export type CommitteeRow            = typeof committees.$inferSelect;
export type CommitteeInsert         = typeof committees.$inferInsert;
export type CommitteeMemberRow      = typeof committeeMembers.$inferSelect;
export type CommitteeMemberInsert   = typeof committeeMembers.$inferInsert;
export type CommitteeTermsHistoryRow    = typeof committeeTermsHistory.$inferSelect;
export type CommitteeTermsHistoryInsert = typeof committeeTermsHistory.$inferInsert;

/** Module schema map — merged into the Drizzle client in shared/db.ts. */
export const schema = { committees, committeeMembers, committeeTermsHistory };
