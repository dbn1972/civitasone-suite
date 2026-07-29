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
  applicationDeadline: timestamp("application_deadline", { withTimezone: true }),
  minExperienceYears: integer("min_experience_years"),
  feesMinor:     bigint("fees_minor", { mode: "bigint" }),
  feeExemption:  text("fee_exemption"),
  requiredDocuments: jsonb("required_documents").notNull().default([]),
  selectionProcess: text("selection_process"),
  importantDates: jsonb("important_dates").notNull().default({}),
  portalScope:   varchar("portal_scope", { length: 16 }).notNull().default("public"),
  titleAlt:      varchar("title_alt", { length: 300 }),
  descriptionAlt: text("description_alt"),
  corrigendumCount: integer("corrigendum_count").notNull().default(0),
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
  offerNo:       varchar("offer_no", { length: 48 }),
  offerVersion:  integer("offer_version").notNull().default(1),
  basicMinor:        bigint("basic_minor", { mode: "bigint" }).notNull().default(0n),
  joiningBonusMinor: bigint("joining_bonus_minor", { mode: "bigint" }).notNull().default(0n),
  relocationMinor:   bigint("relocation_minor", { mode: "bigint" }).notNull().default(0n),
  variablePayMinor:  bigint("variable_pay_minor", { mode: "bigint" }).notNull().default(0n),
  grossCtcMinor:     bigint("gross_ctc_minor", { mode: "bigint" }).notNull().default(0n),
  grade:         varchar("grade", { length: 48 }),
  templateRef:   varchar("template_ref", { length: 200 }),
  approvalChain: jsonb("approval_chain").notNull().default([]),
  currentStage:  integer("current_stage").notNull().default(-1),
  releasedAt:    timestamp("released_at", { withTimezone: true }),
  approvedAt:    timestamp("approved_at", { withTimezone: true }),
  expiresAt:     date("expires_at"),
  acceptedAt:    timestamp("accepted_at", { withTimezone: true }),
  acceptedVersion: integer("accepted_version"),
  acceptanceMeta:  jsonb("acceptance_meta"),
  declinedAt:    timestamp("declined_at", { withTimezone: true }),
  declineReasonCode: varchar("decline_reason_code", { length: 24 }),
  declineRemarks: text("decline_remarks"),
  withdrawReason: text("withdraw_reason"),
  supersedesOfferId: uuid("supersedes_offer_id"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

/** Immutable offer lifecycle audit trail (R-RA-0164). */
export const hrmsOfferEvents = recruitmentSchema.table("hrms_offer_events", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  offerId:       uuid("offer_id").notNull(),
  applicationId: uuid("application_id").notNull(),
  action:        varchar("action", { length: 16 }).notNull(),
  reasonCode:    varchar("reason_code", { length: 24 }),
  remarks:       text("remarks"),
  actorId:       uuid("actor_id").notNull(),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type OfferEventRow = typeof hrmsOfferEvents.$inferSelect;


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
  scorecardTemplate: jsonb("scorecard_template").$type<unknown[]>().notNull().default([]),
  cutoffScore:     integer("cutoff_score"),
  panelScore:      integer("panel_score"),
  consolidatedAt:  timestamp("consolidated_at", { withTimezone: true }),
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

/** Independent per-interviewer score (R-RA-0146). */
export const hrmsInterviewScores = recruitmentSchema.table("hrms_interview_scores", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  interviewId:   uuid("interview_id").notNull(),
  interviewerId: uuid("interviewer_id").notNull(),
  scores:        jsonb("scores").$type<Record<string, number>>().notNull().default({}),
  overallScore:  integer("overall_score"),
  comments:      text("comments"),
  submitted:     boolean("submitted").notNull().default(false),
  submittedAt:   timestamp("submitted_at", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type InterviewScoreRow = typeof hrmsInterviewScores.$inferSelect;

/** Immutable corrigendum / extension / cancellation log (R-RA-0068). */
export const hrmsVacancyCorrigenda = recruitmentSchema.table("hrms_vacancy_corrigenda", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  jobOpeningId: uuid("job_opening_id").notNull(),
  seq:          integer("seq").notNull(),
  action:       varchar("action", { length: 16 }).notNull(),
  changes:      text("changes").notNull(),
  oldDeadline:  timestamp("old_deadline", { withTimezone: true }),
  newDeadline:  timestamp("new_deadline", { withTimezone: true }),
  actorId:      uuid("actor_id").notNull(),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type CorrigendumRow = typeof hrmsVacancyCorrigenda.$inferSelect;

export const schema = { hrmsJobOpenings, hrmsApplications, hrmsOffers, hrmsInterviews, hrmsScreeningEvents, hrmsOfferEvents, hrmsInterviewScores, hrmsVacancyCorrigenda };
