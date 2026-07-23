/**
 * inspection-service: Survey & Sampling module Drizzle schema.
 *
 * Defines the `survey` PG schema with tables:
 * - survey_definitions — survey definitions with questionnaire and sampling config
 * - sampling_frames — selected populations for a survey
 * - survey_responses — individual survey response submissions
 * - survey_aggregations — computed aggregation summaries
 *
 * _Requirements: SVC-104_
 */
import {
  pgSchema,
  uuid,
  text,
  integer,
  varchar,
  timestamp,
  jsonb,
  numeric,
} from "drizzle-orm/pg-core";

/** The `survey` PG schema — survey & sampling management. */
export const surveySchema = pgSchema("survey");

// ── survey.survey_definitions ─────────────────────────────────────────────────

export interface QuestionnaireItem {
  id: string;
  question: string;
  fieldType: string;
  required: boolean;
  options?: string[];
}

export const surveyDefinitions = surveySchema.table("survey_definitions", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  title:               text("title").notNull(),
  description:         text("description"),
  targetEntityType:    varchar("target_entity_type", { length: 64 }).notNull(),
  questionnaire:       jsonb("questionnaire").notNull(), // Array<QuestionnaireItem>
  samplingMethod:      varchar("sampling_method", { length: 16 }).notNull()
                       .$type<"random" | "stratified" | "systematic">(),
  sampleSizePercent:   numeric("sample_size_percent", { precision: 5, scale: 2 }).notNull(),
  stratificationField: text("stratification_field"),
  status:              varchar("status", { length: 16 }).notNull().default("draft")
                       .$type<"draft" | "active" | "closed">(),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid("created_by").notNull(),
  updatedBy:           uuid("updated_by").notNull(),
  version:             integer("version").notNull().default(1),
});

// ── survey.sampling_frames ────────────────────────────────────────────────────

export const samplingFrames = surveySchema.table("sampling_frames", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  surveyId:          uuid("survey_id").notNull(),
  entityIds:         jsonb("entity_ids").notNull(), // string[]
  totalPopulation:   integer("total_population").notNull(),
  sampleSize:        integer("sample_size").notNull(),
  selectedAt:        timestamp("selected_at", { withTimezone: true }).notNull().defaultNow(),
  selectionCriteria: jsonb("selection_criteria"),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  version:           integer("version").notNull().default(1),
});

// ── survey.survey_responses ───────────────────────────────────────────────────

export const surveyResponses = surveySchema.table("survey_responses", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  surveyId:     uuid("survey_id").notNull(),
  entityId:     uuid("entity_id").notNull(),
  inspectorId:  uuid("inspector_id").notNull(),
  answers:      jsonb("answers").notNull(), // Record<questionId, value>
  capturedAt:   timestamp("captured_at", { withTimezone: true }).notNull(),
  deviceId:     text("device_id"),
  syncUploadId: uuid("sync_upload_id"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

// ── survey.survey_aggregations ────────────────────────────────────────────────

export const surveyAggregations = surveySchema.table("survey_aggregations", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  surveyId:          uuid("survey_id").notNull(),
  computedAt:        timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  responseCount:     integer("response_count").notNull(),
  responseRate:      numeric("response_rate", { precision: 5, scale: 2 }).notNull(),
  questionSummaries: jsonb("question_summaries").notNull(), // Record<questionId, {mean?, mode?, distribution?}>
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  version:           integer("version").notNull().default(1),
});

// ── Inferred types ────────────────────────────────────────────────────────────
export type SurveyDefinitionRow = typeof surveyDefinitions.$inferSelect;
export type SurveyDefinitionInsert = typeof surveyDefinitions.$inferInsert;
export type SamplingFrameRow = typeof samplingFrames.$inferSelect;
export type SamplingFrameInsert = typeof samplingFrames.$inferInsert;
export type SurveyResponseRow = typeof surveyResponses.$inferSelect;
export type SurveyResponseInsert = typeof surveyResponses.$inferInsert;
export type SurveyAggregationRow = typeof surveyAggregations.$inferSelect;
export type SurveyAggregationInsert = typeof surveyAggregations.$inferInsert;

export const schema = { surveyDefinitions, samplingFrames, surveyResponses, surveyAggregations };
