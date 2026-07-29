import { uuid, varchar, integer, boolean, jsonb, numeric, timestamp } from "drizzle-orm/pg-core";
import { assessmentSchema } from "./blueprint-schema.js";

export const hrmsAssessmentSchedules = assessmentSchema.table("hrms_assessment_schedules", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  blueprintId: uuid("blueprint_id").notNull(),
  title:       varchar("title", { length: 256 }).notNull(),
  mode:        varchar("mode", { length: 16 }).notNull().default("online"),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  windowEnd:   timestamp("window_end", { withTimezone: true }).notNull(),
  slots:       jsonb("slots").notNull().default([]),
  paper:       jsonb("paper").notNull().default([]),
  totalMarks:  integer("total_marks").notNull().default(0),
  status:      varchar("status", { length: 16 }).notNull().default("scheduled"),
  version:     integer("version").notNull().default(1),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
});

export const hrmsAssessmentAttempts = assessmentSchema.table("hrms_assessment_attempts", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  tenantId:           uuid("tenant_id").notNull(),
  scheduleId:         uuid("schedule_id").notNull(),
  blueprintId:        uuid("blueprint_id").notNull(),
  candidateId:        uuid("candidate_id").notNull(),
  applicationId:      uuid("application_id"),
  slotLabel:          varchar("slot_label", { length: 64 }),
  status:             varchar("status", { length: 20 }).notNull().default("assigned"),
  identityVerified:   boolean("identity_verified").notNull().default(false),
  identityMethod:     varchar("identity_method", { length: 32 }),
  identityMeta:       jsonb("identity_meta").notNull().default({}),
  identityVerifiedAt: timestamp("identity_verified_at", { withTimezone: true }),
  accommodation:      jsonb("accommodation").notNull().default({}),
  questionOrder:      jsonb("question_order").notNull().default([]),
  startedAt:          timestamp("started_at", { withTimezone: true }),
  deadlineAt:         timestamp("deadline_at", { withTimezone: true }),
  submittedAt:        timestamp("submitted_at", { withTimezone: true }),
  lastSavedAt:        timestamp("last_saved_at", { withTimezone: true }),
  totalScore:         numeric("total_score", { precision: 8, scale: 2 }),
  maxScore:           numeric("max_score", { precision: 8, scale: 2 }),
  sectionScores:      jsonb("section_scores").notNull().default({}),
  needsManualEval:    boolean("needs_manual_eval").notNull().default(false),
  result:             varchar("result", { length: 16 }).notNull().default("pending"),
  evaluatedAt:        timestamp("evaluated_at", { withTimezone: true }),
  version:            integer("version").notNull().default(1),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:          uuid("created_by").notNull(),
  updatedBy:          uuid("updated_by").notNull(),
});

export const hrmsAssessmentResponses = assessmentSchema.table("hrms_assessment_responses", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  attemptId:   uuid("attempt_id").notNull(),
  questionId:  uuid("question_id").notNull(),
  response:    jsonb("response").notNull().default({}),
  autoScore:   numeric("auto_score", { precision: 8, scale: 2 }),
  isCorrect:   boolean("is_correct"),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }),
  savedAt:     timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ScheduleRow = typeof hrmsAssessmentSchedules.$inferSelect;
export type ScheduleInsert = typeof hrmsAssessmentSchedules.$inferInsert;
export type AttemptRow = typeof hrmsAssessmentAttempts.$inferSelect;
export type AttemptInsert = typeof hrmsAssessmentAttempts.$inferInsert;
export type ResponseRow = typeof hrmsAssessmentResponses.$inferSelect;
export type ResponseInsert = typeof hrmsAssessmentResponses.$inferInsert;

export const schema = { hrmsAssessmentSchedules, hrmsAssessmentAttempts, hrmsAssessmentResponses };
