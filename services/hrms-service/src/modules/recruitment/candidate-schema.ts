import {
  pgSchema, uuid, varchar, boolean, date, text, integer, bigint, numeric, timestamp, jsonb,
} from "drizzle-orm/pg-core";

export const candidateSchema = pgSchema("candidate");

export const hrmsCandidates = candidateSchema.table("hrms_candidates", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  email:             varchar("email", { length: 200 }).notNull(),
  normalizedEmail:   varchar("normalized_email", { length: 200 }).notNull(),
  mobile:            varchar("mobile", { length: 20 }),
  normalizedMobile:  varchar("normalized_mobile", { length: 10 }),
  emailVerified:     boolean("email_verified").notNull().default(false),
  mobileVerified:    boolean("mobile_verified").notNull().default(false),
  resumeFingerprint: varchar("resume_fingerprint", { length: 128 }),
  fullName:          varchar("full_name", { length: 200 }),
  dateOfBirth:       date("date_of_birth"),
  gender:            varchar("gender", { length: 16 }),
  maritalStatus:     varchar("marital_status", { length: 16 }),
  nationality:       varchar("nationality", { length: 64 }),
  guardianName:      varchar("guardian_name", { length: 200 }),
  correspondenceAddress: text("correspondence_address"),
  permanentAddress:  text("permanent_address"),
  category:          varchar("category", { length: 8 }),
  subCategory:       varchar("sub_category", { length: 32 }),
  disability:        boolean("disability").notNull().default(false),
  exServiceman:      boolean("ex_serviceman").notNull().default(false),
  disabilityType:    varchar("disability_type", { length: 24 }),
  disabilityPercentage: integer("disability_percentage"),
  freedomFighterDependent: boolean("freedom_fighter_dependent").notNull().default(false),
  reservationDocs:   jsonb("reservation_docs").$type<string[]>().notNull().default([]),
  relationshipDeclaration: jsonb("relationship_declaration").$type<Record<string, unknown>>().notNull().default({}),
  activeResumeRef:   varchar("active_resume_ref", { length: 512 }),
  consentVersion:    varchar("consent_version", { length: 24 }),
  consentAcceptedAt: timestamp("consent_accepted_at", { withTimezone: true }),
  status:            varchar("status", { length: 16 }).notNull().default("draft"),
  submittedAt:       timestamp("submitted_at", { withTimezone: true }),
  withdrawnAt:       timestamp("withdrawn_at", { withTimezone: true }),
  dataRequestAt:     timestamp("data_request_at", { withTimezone: true }),
  version:           integer("version").notNull().default(1),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  updatedBy:         uuid("updated_by").notNull(),
});

export const hrmsCandidateEducation = candidateSchema.table("hrms_candidate_education", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  candidateId:     uuid("candidate_id").notNull(),
  qualification:   varchar("qualification", { length: 120 }).notNull(),
  subject:         varchar("subject", { length: 200 }),
  institution:     varchar("institution", { length: 200 }),
  boardUniversity: varchar("board_university", { length: 200 }),
  yearOfPassing:   integer("year_of_passing"),
  marksPercent:    numeric("marks_percent", { precision: 5, scale: 2 }),
  grade:           varchar("grade", { length: 16 }),
  verificationStatus: varchar("verification_status", { length: 16 }).notNull().default("unverified"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
});

export const hrmsCandidateEmployment = candidateSchema.table("hrms_candidate_employment", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  candidateId:     uuid("candidate_id").notNull(),
  employer:        varchar("employer", { length: 200 }).notNull(),
  roleTitle:       varchar("role_title", { length: 200 }),
  fromDate:        date("from_date"),
  toDate:          date("to_date"),
  noticePeriodDays: integer("notice_period_days"),
  ctcMinor:        bigint("ctc_minor", { mode: "bigint" }),
  reasonForLeaving: text("reason_for_leaving"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
});

export type CandidateRow = typeof hrmsCandidates.$inferSelect;
export type CandidateInsert = typeof hrmsCandidates.$inferInsert;
export type EducationRow = typeof hrmsCandidateEducation.$inferSelect;
export type EmploymentRow = typeof hrmsCandidateEmployment.$inferSelect;

export const hrmsCandidateReferences = candidateSchema.table("hrms_candidate_references", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  candidateId:   uuid("candidate_id").notNull(),
  refName:       varchar("ref_name", { length: 200 }).notNull(),
  relationship:  varchar("relationship", { length: 120 }).notNull(),
  organisation:  varchar("organisation", { length: 200 }),
  designation:   varchar("designation", { length: 120 }),
  email:         varchar("email", { length: 200 }),
  phone:         varchar("phone", { length: 20 }),
  yearsKnown:    integer("years_known"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ReferenceRow = typeof hrmsCandidateReferences.$inferSelect;
export type ReferenceInsert = typeof hrmsCandidateReferences.$inferInsert;

// R-RA-0087: multiple resume versions per candidate; exactly one active. The
// file itself lives in object storage — only its key/metadata is recorded here.
export const hrmsCandidateResumes = candidateSchema.table("hrms_candidate_resumes", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  candidateId:   uuid("candidate_id").notNull(),
  versionNo:     integer("version_no").notNull(),
  fileKey:       varchar("file_key", { length: 512 }).notNull(),
  fileName:      varchar("file_name", { length: 255 }).notNull(),
  mimeType:      varchar("mime_type", { length: 128 }).notNull(),
  fileSizeBytes: bigint("file_size_bytes", { mode: "bigint" }).notNull(),
  fingerprint:   varchar("fingerprint", { length: 128 }),
  label:         varchar("label", { length: 120 }),
  isActive:      boolean("is_active").notNull().default(false),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
});
export type ResumeRow = typeof hrmsCandidateResumes.$inferSelect;
export type ResumeInsert = typeof hrmsCandidateResumes.$inferInsert;

export const schema = { hrmsCandidates, hrmsCandidateEducation, hrmsCandidateEmployment, hrmsCandidateReferences, hrmsCandidateResumes };
