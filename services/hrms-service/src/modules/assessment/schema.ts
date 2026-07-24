import {
  pgSchema, uuid, text, integer, numeric, boolean, jsonb, timestamp, varchar,
} from "drizzle-orm/pg-core";

export const assessmentSchema = pgSchema("assessment");

export const questionBanks = assessmentSchema.table("question_banks", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  title:         text("title").notNull(),
  competencyRef: text("competency_ref"),
  status:        varchar("status", { length: 24 }).notNull().default("active"),
  createdBy:     uuid("created_by").notNull(),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const questions = assessmentSchema.table("questions", {
  id:       uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  bankId:   uuid("bank_id").notNull(),
  qtype:    varchar("qtype", { length: 16 }).notNull(),
  stem:     text("stem").notNull(),
  options:  jsonb("options").$type<Array<{ id: string; text: string }>>().notNull().default([]),
  correct:  jsonb("correct").$type<string[]>().notNull().default([]),
  marks:    numeric("marks").notNull().default("1"),
  active:   boolean("active").notNull().default(true),
});

export const assessments = assessmentSchema.table("assessments", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  title:        text("title").notNull(),
  courseRef:    text("course_ref"),
  bankId:       uuid("bank_id").notNull(),
  passingScore: numeric("passing_score").notNull(),
  durationMins: integer("duration_mins").notNull().default(30),
  maxAttempts:  integer("max_attempts").notNull().default(1),
  validityMonths: integer("validity_months"),
  status:       varchar("status", { length: 24 }).notNull().default("draft"),
  createdBy:    uuid("created_by").notNull(),
  approvedBy:   uuid("approved_by"),
  publishedAt:  timestamp("published_at", { withTimezone: true }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const attempts = assessmentSchema.table("attempts", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  assessmentId: uuid("assessment_id").notNull(),
  employeeId:   uuid("employee_id").notNull(),
  attemptNo:    integer("attempt_no").notNull(),
  status:       varchar("status", { length: 16 }).notNull().default("in_progress"),
  startedAt:    timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  submittedAt:  timestamp("submitted_at", { withTimezone: true }),
  score:        numeric("score"),
  passed:       boolean("passed"),
});

export const attemptAnswers = assessmentSchema.table("attempt_answers", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  attemptId:    uuid("attempt_id").notNull(),
  questionId:   uuid("question_id").notNull(),
  response:     jsonb("response").$type<string[]>().notNull().default([]),
  awardedMarks: numeric("awarded_marks").notNull().default("0"),
});

export const certificates = assessmentSchema.table("certificates", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  assessmentId:  uuid("assessment_id").notNull(),
  attemptId:     uuid("attempt_id").notNull().unique(),
  employeeId:    uuid("employee_id").notNull(),
  certificateNo: text("certificate_no").notNull().unique(),
  verifyToken:   text("verify_token").notNull().unique(),
  issuedAt:      timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  validUntil:    timestamp("valid_until", { withTimezone: true }),
  status:        varchar("status", { length: 16 }).notNull().default("active"),
});

export type QuestionRow = typeof questions.$inferSelect;
export type AssessmentRow = typeof assessments.$inferSelect;
export type AttemptRow = typeof attempts.$inferSelect;
export type CertificateRow = typeof certificates.$inferSelect;

export const schema = {
  questionBanks, questions, assessments, attempts, attemptAnswers, certificates,
};
