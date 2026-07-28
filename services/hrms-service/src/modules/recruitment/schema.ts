import { encryptedText } from "../../shared/pii-crypto.js";
import {
  pgSchema, uuid, text, integer, bigint, char, varchar, date, timestamp, jsonb, boolean,
} from "drizzle-orm/pg-core";

export const recruitmentSchema = pgSchema("recruitment");

export const hrmsJobOpenings = recruitmentSchema.table("hrms_job_openings", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  refNo:         text("ref_no").notNull(),
  title:         text("title").notNull(),
  departmentId:  uuid("department_id").notNull(),
  designationId: uuid("designation_id"),
  vacancies:     integer("vacancies").notNull().default(1),
  description:   text("description"),
  vacancyType:   varchar("vacancy_type", { length: 24 }).notNull().default("regular"),
  location:      varchar("location", { length: 200 }),
  qualification: varchar("qualification", { length: 500 }),
  payRange:      varchar("pay_range", { length: 120 }),
  isPublished:   varchar("is_published", { length: 5 }).notNull().default("false"),
  eligibility:   jsonb("eligibility").notNull().default({}),
  status:        varchar("status", { length: 24 }).notNull().default("open"),
  postedAt:      date("posted_at"),
  closesAt:      date("closes_at"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export const hrmsApplications = recruitmentSchema.table("hrms_applications", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  jobOpeningId:  uuid("job_opening_id").notNull(),
  applicantName: text("applicant_name").notNull(),
  email:         text("email"),
  mobile:        encryptedText("mobile"),
  resumeRef:     text("resume_ref"),
  resumeFileKey: text("resume_file_key"),
  skills:        text("skills").array(),
  qualification: varchar("qualification", { length: 500 }),
  experienceYears: integer("experience_years"),
  source:        varchar("source", { length: 32 }).notNull().default("internal"),
  applicationNo: varchar("application_no", { length: 48 }),
  dateOfBirth:   date("date_of_birth"),
  category:      varchar("category", { length: 16 }),
  eligibilityResult: jsonb("eligibility_result"),
  withdrawReason: text("withdraw_reason"),
  dedupKey:      varchar("dedup_key", { length: 320 }),
  screeningDecision:  varchar("screening_decision", { length: 16 }).notNull().default("pending"),
  screeningReasonCode: varchar("screening_reason_code", { length: 24 }),
  screeningRemarks:   text("screening_remarks"),
  screenedBy:         uuid("screened_by"),
  screenedAt:         timestamp("screened_at", { withTimezone: true }),
  shortlistFrozen:    boolean("shortlist_frozen").notNull().default(false),
  stage:         varchar("stage", { length: 32 }).notNull().default("applied"),
  status:        varchar("status", { length: 24 }).notNull().default("active"),
  appliedAt:     timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export const hrmsOffers = recruitmentSchema.table("hrms_offers", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  applicationId: uuid("application_id").notNull(),
  ctcMinor:      bigint("ctc_minor", { mode: "bigint" }).notNull().default(0n),
  currency:      char("currency", { length: 3 }).notNull().default("INR"),
  joiningDate:   date("joining_date"),
  status:        varchar("status", { length: 24 }).notNull().default("draft"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});


// Maps the existing recruitment.hrms_interviews table (migration 0008). The
// scheduling route was previously an in-memory array; it now persists here.
export const hrmsInterviews = recruitmentSchema.table("hrms_interviews", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  applicationId:   uuid("application_id").notNull(),
  jobOpeningId:    uuid("job_opening_id").notNull(),
  roundNumber:     integer("round_number").notNull().default(1),
  roundType:       varchar("round_type", { length: 32 }).notNull().default("technical"),
  scheduledDate:   date("scheduled_date").notNull(),
  scheduledTime:   varchar("scheduled_time", { length: 5 }).notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  mode:            varchar("mode", { length: 16 }).notNull().default("in_person"),
  location:        varchar("location", { length: 512 }),
  meetingLink:     varchar("meeting_link", { length: 1024 }),
  panelMembers:    jsonb("panel_members").$type<unknown[]>().notNull().default([]),
  scorecard:       jsonb("scorecard").$type<Record<string, unknown>>(),
  status:          varchar("status", { length: 24 }).notNull().default("scheduled"),
  feedback:        text("feedback"),
  recommendation:  varchar("recommendation", { length: 24 }),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export type JobOpeningRow = typeof hrmsJobOpenings.$inferSelect;
export type ApplicationRow = typeof hrmsApplications.$inferSelect;
export type InterviewRow = typeof hrmsInterviews.$inferSelect;

/** Immutable screening audit trail (R-RA-0119). */
export const hrmsScreeningEvents = recruitmentSchema.table("hrms_screening_events", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  applicationId: uuid("application_id").notNull(),
  jobOpeningId:  uuid("job_opening_id").notNull(),
  action:        varchar("action", { length: 16 }).notNull(),
  decision:      varchar("decision", { length: 16 }),
  reasonCode:    varchar("reason_code", { length: 24 }),
  remarks:       text("remarks"),
  isOverride:    boolean("is_override").notNull().default(false),
  actorId:       uuid("actor_id").notNull(),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ScreeningEventRow = typeof hrmsScreeningEvents.$inferSelect;

export const schema = { hrmsJobOpenings, hrmsApplications, hrmsOffers, hrmsInterviews, hrmsScreeningEvents };
