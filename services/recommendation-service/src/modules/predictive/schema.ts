/**
 * predictive module — CR-AI-01 predictive model scores (LTV, renewal, fraud, churn).
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb, numeric, unique } from "drizzle-orm/pg-core";

export const recommendationSchema = pgSchema("recommendation");

/**
 * One live score per (subject, model). ml-service upserts through
 * PUT /v1/recommendations/predictive/:subjectType/:subjectId/:modelType.
 *
 * `score` and `confidence` are numeric, which the postgres driver returns as a
 * STRING. That is deliberate and must be preserved end-to-end — see repo.toView.
 */
export const predictiveScores = recommendationSchema.table(
  "predictive_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    /** 'profile' | 'account' | 'deal' (CHECK constraint in migration 0002). */
    subjectType: varchar("subject_type", { length: 24 }).notNull(),
    subjectId: uuid("subject_id").notNull(),
    /** 'ltv' | 'renewal' | 'fraud' | 'churn' (CHECK constraint in migration 0002). */
    modelType: varchar("model_type", { length: 24 }).notNull(),
    score: numeric("score", { precision: 12, scale: 4 }).notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    modelVersion: varchar("model_version", { length: 64 }),
    /** Feature vector used for this score, retained so the score can be explained. */
    features: jsonb("features").$type<Record<string, unknown>>().notNull().default({}),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull(),
    updatedBy: uuid("updated_by").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => ({
    subjectModelUnique: unique("uq_predictive_scores_subject_model").on(
      t.tenantId,
      t.subjectType,
      t.subjectId,
      t.modelType,
    ),
  }),
);

export type PredictiveScoreRow = typeof predictiveScores.$inferSelect;
export type PredictiveScoreInsert = typeof predictiveScores.$inferInsert;

export const schema = { predictiveScores };
