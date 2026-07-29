import {
  pgSchema, uuid, varchar, integer, text, jsonb, timestamp,
} from "drizzle-orm/pg-core";

export const assessmentSchema = pgSchema("assessment");

export const hrmsAssessmentBlueprints = assessmentSchema.table("hrms_assessment_blueprints", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  code:            varchar("code", { length: 64 }).notNull(),
  title:           varchar("title", { length: 256 }).notNull(),
  roleTitle:       varchar("role_title", { length: 200 }),
  designationId:   uuid("designation_id"),
  competencies:    jsonb("competencies").notNull().default([]),
  allowedTypes:    jsonb("allowed_types").notNull().default([]),
  durationMinutes: integer("duration_minutes").notNull(),
  scoringConfig:   jsonb("scoring_config").notNull().default({}),
  status:          varchar("status", { length: 16 }).notNull().default("draft"),
  version:         integer("version").notNull().default(1),
  effectiveFrom:   timestamp("effective_from", { withTimezone: true }),
  activatedBy:     uuid("activated_by"),
  activatedAt:     timestamp("activated_at", { withTimezone: true }),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
});

export const hrmsAssessmentQuestions = assessmentSchema.table("hrms_assessment_questions", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  topic:         varchar("topic", { length: 120 }).notNull(),
  qtype:         varchar("qtype", { length: 24 }).notNull(),
  stem:          text("stem").notNull(),
  options:       jsonb("options").notNull().default([]),
  answerKey:     jsonb("answer_key").notNull().default({}),
  difficulty:    varchar("difficulty", { length: 12 }).notNull(),
  marks:         integer("marks").notNull(),
  status:        varchar("status", { length: 12 }).notNull().default("draft"),
  usageCount:    integer("usage_count").notNull().default(0),
  lastUsedAt:    timestamp("last_used_at", { withTimezone: true }),
  version:       integer("version").notNull().default(1),
  validatedBy:   uuid("validated_by"),
  validatedAt:   timestamp("validated_at", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
});

export const hrmsAssessmentEvents = assessmentSchema.table("hrms_assessment_events", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  entityType: varchar("entity_type", { length: 16 }).notNull(),
  entityId:   uuid("entity_id").notNull(),
  action:     varchar("action", { length: 24 }).notNull(),
  detail:     jsonb("detail").notNull().default({}),
  actorId:    uuid("actor_id").notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BlueprintRow = typeof hrmsAssessmentBlueprints.$inferSelect;
export type BlueprintInsert = typeof hrmsAssessmentBlueprints.$inferInsert;
export type QuestionRow = typeof hrmsAssessmentQuestions.$inferSelect;
export type QuestionInsert = typeof hrmsAssessmentQuestions.$inferInsert;
export type AssessmentEventRow = typeof hrmsAssessmentEvents.$inferSelect;

export const schema = { hrmsAssessmentBlueprints, hrmsAssessmentQuestions, hrmsAssessmentEvents };
