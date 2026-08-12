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
  isPublished:   boolean("is_published").notNull().default(false),
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
  // R-RA-0118 policy flag: when true, a rejection notice may disclose the
  // high-level reason CATEGORY to the candidate (never scores/remarks).
  discloseRejectionReason: boolean("disclose_rejection_reason").notNull().default(false),
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
  joiningExtensionStatus: varchar("joining_extension_status", { length: 16 }).notNull().default("none"),
  requestedJoiningDate:   date("requested_joining_date"),
  originalJoiningDate:    date("original_joining_date"),
  joiningExtensionReason: text("joining_extension_reason"),
  requestedBy:            uuid("requested_by"),
  requestedAt:            timestamp("requested_at", { withTimezone: true }),
  joiningExtensionBy:     uuid("joining_extension_by"),
  joiningExtensionAt:     timestamp("joining_extension_at", { withTimezone: true }),
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
  outcomeStatus:   varchar("outcome_status", { length: 16 }).notNull().default("pending"),
  rejectionReason: varchar("rejection_reason", { length: 32 }),
  rejectionNote:   text("rejection_note"),
  waitlistRank:    integer("waitlist_rank"),
  recommendationValidUntil: date("recommendation_valid_until"),
  outcomeBy:       uuid("outcome_by"),
  outcomeAt:       timestamp("outcome_at", { withTimezone: true }),
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

export const hrmsInterviewPanelists = recruitmentSchema.table("hrms_interview_panelists", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  interviewId:  uuid("interview_id").notNull(),
  memberId:     uuid("member_id").notNull(),
  memberName:   varchar("member_name", { length: 256 }).notNull(),
  panelRole:    varchar("panel_role", { length: 24 }).notNull().default("member"),
  availability: jsonb("availability").$type<Record<string, unknown>>().notNull().default({}),
  coiDeclared:  boolean("coi_declared").notNull().default(false),
  coiType:      varchar("coi_type", { length: 24 }).notNull().default("none"),
  coiNote:      text("coi_note"),
  recused:      boolean("recused").notNull().default(false),
  recusedAt:    timestamp("recused_at", { withTimezone: true }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type PanelistRow = typeof hrmsInterviewPanelists.$inferSelect;
export type PanelistInsert = typeof hrmsInterviewPanelists.$inferInsert;

/**
 * Maker-checker override of an automated/manual screening decision (R-RA-0111).
 * An HR admin REQUESTS a change to an already-decided application; a DIFFERENT
 * admin (separation of duties: approver != requester and != the original
 * screener) approves or rejects it. Only on approval is the application's
 * decision actually changed. One pending request per application at a time.
 */
export const hrmsScreeningOverrides = recruitmentSchema.table("hrms_screening_overrides", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  applicationId:     uuid("application_id").notNull(),
  jobOpeningId:      uuid("job_opening_id").notNull(),
  fromDecision:      varchar("from_decision", { length: 16 }).notNull(),
  toDecision:        varchar("to_decision", { length: 16 }).notNull(),
  // The application.version at request time — approval requires an exact match
  // so an A→B→A decision cycle (same value, new version) is caught as stale.
  applicationVersion: integer("application_version").notNull(),
  reasonCode:        varchar("reason_code", { length: 24 }),
  reason:            text("reason").notNull(),
  status:            varchar("status", { length: 12 }).notNull().default("pending"),
  originalScreenedBy: uuid("original_screened_by"),
  requestedBy:       uuid("requested_by").notNull(),
  requestedAt:       timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  decidedBy:         uuid("decided_by"),
  decidedAt:         timestamp("decided_at", { withTimezone: true }),
  decisionNote:      text("decision_note"),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:           integer("version").notNull().default(1),
});
export type ScreeningOverrideRow = typeof hrmsScreeningOverrides.$inferSelect;
export type ScreeningOverrideInsert = typeof hrmsScreeningOverrides.$inferInsert;

/**
 * Interview communications lifecycle log (R-RA-0142). Append-only record of each
 * candidate comm (invite/reminder/reschedule/cancel) and how it was dispatched
 * (queued to the outbox when the feature flag is on, else recorded as a stub).
 */
export const hrmsInterviewComms = recruitmentSchema.table("hrms_interview_comms", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  interviewId:   uuid("interview_id").notNull(),
  applicationId: uuid("application_id").notNull(),
  commType:      varchar("comm_type", { length: 12 }).notNull(),
  channel:       varchar("channel", { length: 8 }).notNull(),
  status:        varchar("status", { length: 10 }).notNull(),
  message:       text("message").notNull(),
  scheduledFor:  timestamp("scheduled_for", { withTimezone: true }),
  idempotencyKey: varchar("idempotency_key", { length: 64 }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
});
export type InterviewCommRow = typeof hrmsInterviewComms.$inferSelect;
export type InterviewCommInsert = typeof hrmsInterviewComms.$inferInsert;

/**
 * Candidate interview self-service responses (R-RA-0143): a confirm (terminal)
 * or a reschedule_request (pending → approved/declined by HR). One open
 * reschedule request per interview at a time.
 */
export const hrmsInterviewResponses = recruitmentSchema.table("hrms_interview_responses", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  interviewId:   uuid("interview_id").notNull(),
  applicationId: uuid("application_id").notNull(),
  responseType:  varchar("response_type", { length: 20 }).notNull(),
  status:        varchar("status", { length: 12 }).notNull(),
  preferredDate: date("preferred_date"),
  preferredTime: varchar("preferred_time", { length: 5 }),
  reason:        text("reason"),
  fromDate:      date("from_date"),
  fromTime:      varchar("from_time", { length: 5 }),
  decidedBy:     uuid("decided_by"),
  decidedAt:     timestamp("decided_at", { withTimezone: true }),
  decisionNote:  text("decision_note"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  version:       integer("version").notNull().default(1),
});
export type InterviewResponseRow = typeof hrmsInterviewResponses.$inferSelect;
export type InterviewResponseInsert = typeof hrmsInterviewResponses.$inferInsert;

/**
 * Interview recording / transcript with consent + retention (R-RA-0152). Only
 * the object-store key is stored (bytes live behind the storage seam). Consent
 * is mandatory; retention_until drives the purge job; soft-delete on erasure.
 */
export const hrmsInterviewRecordings = recruitmentSchema.table("hrms_interview_recordings", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  interviewId:    uuid("interview_id").notNull(),
  applicationId:  uuid("application_id").notNull(),
  kind:           varchar("kind", { length: 12 }).notNull(),
  storageKey:     varchar("storage_key", { length: 512 }).notNull(),
  consentGiven:   boolean("consent_given").notNull().default(false),
  consentReference: varchar("consent_reference", { length: 200 }),
  consentBy:      uuid("consent_by"),
  consentAt:      timestamp("consent_at", { withTimezone: true }),
  retentionUntil: date("retention_until").notNull(),
  status:         varchar("status", { length: 10 }).notNull().default("active"),
  deletedAt:      timestamp("deleted_at", { withTimezone: true }),
  deletedBy:      uuid("deleted_by"),
  objectPurgedAt: timestamp("object_purged_at", { withTimezone: true }),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  version:        integer("version").notNull().default(1),
});
export type InterviewRecordingRow = typeof hrmsInterviewRecordings.$inferSelect;
export type InterviewRecordingInsert = typeof hrmsInterviewRecordings.$inferInsert;

/**
 * Application fee (R-RA-0099): one fee record per application. Exempt (amount 0),
 * pending, paid (manual/offline reference, or gateway when wired) or refunded.
 * amount_minor is bigint paise. Online gateway payment is an external seam.
 */
export const hrmsApplicationFees = recruitmentSchema.table("hrms_application_fees", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  applicationId:   uuid("application_id").notNull(),
  jobOpeningId:    uuid("job_opening_id").notNull(),
  amountMinor:     bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:        varchar("currency", { length: 3 }).notNull().default("INR"),
  status:          varchar("status", { length: 10 }).notNull().default("pending"),
  exemptionReason: varchar("exemption_reason", { length: 64 }),
  provider:        varchar("provider", { length: 10 }).notNull().default("none"),
  paymentRef:      varchar("payment_ref", { length: 128 }),
  paidAt:          timestamp("paid_at", { withTimezone: true }),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});
export type ApplicationFeeRow = typeof hrmsApplicationFees.$inferSelect;
export type ApplicationFeeInsert = typeof hrmsApplicationFees.$inferInsert;

// DEF-RC-002: candidate job alert subscriptions (T07). A candidate subscribes to
// criteria; when a matching vacancy is published, a notification is triggered.
export const hrmsJobAlerts = recruitmentSchema.table("hrms_job_alerts", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  candidateId:   uuid("candidate_id").notNull(),
  criteria:      jsonb("criteria").$type<Record<string, unknown>>().notNull().default({}),
  channel:       varchar("channel", { length: 8 }).notNull().default("email"),
  active:        boolean("active").notNull().default(true),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:       integer("version").notNull().default(1),
});
export type JobAlertRow = typeof hrmsJobAlerts.$inferSelect;
export type JobAlertInsert = typeof hrmsJobAlerts.$inferInsert;

export const schema = { hrmsJobOpenings, hrmsApplications, hrmsOffers, hrmsInterviews, hrmsScreeningEvents, hrmsOfferEvents, hrmsInterviewScores, hrmsVacancyCorrigenda, hrmsInterviewPanelists, hrmsScreeningOverrides, hrmsInterviewComms, hrmsInterviewResponses, hrmsInterviewRecordings, hrmsApplicationFees, hrmsJobAlerts };
