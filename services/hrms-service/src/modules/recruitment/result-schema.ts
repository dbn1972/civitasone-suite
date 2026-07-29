import { uuid, varchar, integer, jsonb, numeric, text, timestamp } from "drizzle-orm/pg-core";
import { assessmentSchema } from "./blueprint-schema.js";

export const hrmsAssessmentEvaluations = assessmentSchema.table("hrms_assessment_evaluations", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  attemptId:   uuid("attempt_id").notNull(),
  questionId:  uuid("question_id").notNull(),
  evaluatorId: uuid("evaluator_id").notNull(),
  score:       numeric("score", { precision: 8, scale: 2 }).notNull(),
  maxMarks:    integer("max_marks").notNull(),
  remarks:     text("remarks"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const hrmsAssessmentResultEvents = assessmentSchema.table("hrms_assessment_result_events", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  attemptId:  uuid("attempt_id").notNull(),
  action:     varchar("action", { length: 24 }).notNull(),
  detail:     jsonb("detail").notNull().default({}),
  actorId:    uuid("actor_id").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EvaluationRow = typeof hrmsAssessmentEvaluations.$inferSelect;
export type EvaluationInsert = typeof hrmsAssessmentEvaluations.$inferInsert;
export type ResultEventRow = typeof hrmsAssessmentResultEvents.$inferSelect;

export const schema = { hrmsAssessmentEvaluations, hrmsAssessmentResultEvents };
