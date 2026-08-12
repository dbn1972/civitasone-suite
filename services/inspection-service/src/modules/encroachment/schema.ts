/**
 * inspection-service: Encroachment module Drizzle schema.
 *
 * Defines the `encroachment` PG schema with tables:
 * - encroachment_complaints — citizen complaints about encroachment
 * - encroachment_notices — show cause / eviction / demolition notices
 * - encroachment_hearings — scheduled hearings with proceedings
 * - encroachment_removals — removal orders and execution
 *
 * _Requirements: BRD 5.19 ENCR-001..004_
 */
import {
  pgSchema,
  uuid,
  text,
  integer,
  varchar,
  timestamp,
  date,
  bigint,
  jsonb,
} from "drizzle-orm/pg-core";

/** The `encroachment` PG schema. */
export const encroachmentSchema = pgSchema("encroachment");

// ── encroachment.encroachment_complaints ──────────────────────────────────
export const encroachmentComplaints = encroachmentSchema.table("encroachment_complaints", {
  id:                      uuid("id").primaryKey().defaultRandom(),
  tenantId:                uuid("tenant_id").notNull(),
  complaintNumber:         varchar("complaint_number", { length: 40 }).notNull(),
  reportedBy:              uuid("reported_by").notNull(),
  reportedAt:              timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
  location:                jsonb("location").notNull(), // { lat, lng, ward, zone, landmark }
  encroachmentType:        varchar("encroachment_type", { length: 40 }).notNull(),
  description:             text("description").notNull(),
  photos:                  jsonb("photos"), // string[]
  landParcelRef:           text("land_parcel_ref"), // revenue/survey number linkage
  status:                  varchar("status", { length: 30 }).notNull().default("received"),
  verifiedBy:              uuid("verified_by"),
  verifiedAt:              timestamp("verified_at", { withTimezone: true }),
  landVerificationReport:  jsonb("land_verification_report"),
  createdAt:               timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:               timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:               uuid("created_by").notNull(),
  updatedBy:               uuid("updated_by").notNull(),
  version:                 integer("version").notNull().default(1),
});

// ── encroachment.encroachment_notices ─────────────────────────────────────
export const encroachmentNotices = encroachmentSchema.table("encroachment_notices", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  complaintId:       uuid("complaint_id").notNull(),
  noticeNumber:      varchar("notice_number", { length: 40 }).notNull(),
  noticeType:        varchar("notice_type", { length: 20 }).notNull(), // show_cause | eviction | demolition
  issuedTo:          text("issued_to").notNull(),
  issuedAt:          timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  responseDeadline:  date("response_deadline").notNull(),
  status:            varchar("status", { length: 24 }).notNull().default("issued"),
  servedAt:          timestamp("served_at", { withTimezone: true }),
  responseText:      text("response_text"),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  updatedBy:         uuid("updated_by").notNull(),
  version:           integer("version").notNull().default(1),
});

// ── encroachment.encroachment_hearings ────────────────────────────────────
export const encroachmentHearings = encroachmentSchema.table("encroachment_hearings", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  complaintId:      uuid("complaint_id").notNull(),
  noticeId:         uuid("notice_id").notNull(),
  hearingDate:      date("hearing_date").notNull(),
  hearingTime:      varchar("hearing_time", { length: 8 }).notNull(),
  venue:            text("venue").notNull(),
  officerId:        uuid("officer_id").notNull(),
  attendees:        jsonb("attendees"),
  proceedings:      text("proceedings"),
  decision:         varchar("decision", { length: 24 }),
  fineAmountMinor:  bigint("fine_amount_minor", { mode: "bigint" }),
  currency:         varchar("currency", { length: 3 }).notNull().default("INR"),
  nextHearingDate:  date("next_hearing_date"),
  status:           varchar("status", { length: 20 }).notNull().default("scheduled"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

// ── encroachment.encroachment_removals ────────────────────────────────────
export const encroachmentRemovals = encroachmentSchema.table("encroachment_removals", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  complaintId:       uuid("complaint_id").notNull(),
  orderedAt:         timestamp("ordered_at", { withTimezone: true }).notNull().defaultNow(),
  orderedBy:         uuid("ordered_by").notNull(),
  scheduledDate:     date("scheduled_date").notNull(),
  status:            varchar("status", { length: 20 }).notNull().default("ordered"),
  teamMembers:       jsonb("team_members"),
  equipmentUsed:     text("equipment_used"),
  completedAt:       timestamp("completed_at", { withTimezone: true }),
  completionReport:  jsonb("completion_report"),
  photos:            jsonb("photos"),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  updatedBy:         uuid("updated_by").notNull(),
  version:           integer("version").notNull().default(1),
});

// ── Inferred types ────────────────────────────────────────────────────────
export type EncroachmentComplaintRow = typeof encroachmentComplaints.$inferSelect;
export type EncroachmentComplaintInsert = typeof encroachmentComplaints.$inferInsert;
export type EncroachmentNoticeRow = typeof encroachmentNotices.$inferSelect;
export type EncroachmentNoticeInsert = typeof encroachmentNotices.$inferInsert;
export type EncroachmentHearingRow = typeof encroachmentHearings.$inferSelect;
export type EncroachmentHearingInsert = typeof encroachmentHearings.$inferInsert;
export type EncroachmentRemovalRow = typeof encroachmentRemovals.$inferSelect;
export type EncroachmentRemovalInsert = typeof encroachmentRemovals.$inferInsert;

export const schema = { encroachmentComplaints, encroachmentNotices, encroachmentHearings, encroachmentRemovals };
