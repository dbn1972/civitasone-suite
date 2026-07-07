/**
 * training module — Drizzle schema for training run history and A/B experiments.
 * Records every training job execution and tracks experiment configurations
 * for model comparison via traffic splitting.
 *
 * Validates: Requirements 2.1, 5.1
 */
import { pgSchema, uuid, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { mlModels } from "../models/schema.js";

export const mlSchema = pgSchema("ml");

export const mlTrainingRuns = mlSchema.table("ml_training_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  domain: text("domain").notNull(),
  status: text("status").notNull().default("queued"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  recordCount: integer("record_count").notNull().default(0),
  metrics: jsonb("metrics"),
  errorMessage: text("error_message"),
  modelId: uuid("model_id").references(() => mlModels.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantDomainStatus: index("idx_ml_training_runs_tenant_domain").on(t.tenantId, t.domain, t.status),
}));

export const mlExperiments = mlSchema.table("ml_experiments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  domain: text("domain").notNull(),
  name: text("name").notNull(),
  challengerModelId: uuid("challenger_model_id").notNull().references(() => mlModels.id),
  currentModelId: uuid("current_model_id").notNull().references(() => mlModels.id),
  splitPct: integer("split_pct").notNull().default(50),
  status: text("status").notNull().default("active"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantDomainActive: index("idx_ml_experiments_tenant_domain_active").on(t.tenantId, t.domain).where(sql`status = 'active'`),
}));

export type MlTrainingRunRow = typeof mlTrainingRuns.$inferSelect;
export type MlTrainingRunInsert = typeof mlTrainingRuns.$inferInsert;

export type MlExperimentRow = typeof mlExperiments.$inferSelect;
export type MlExperimentInsert = typeof mlExperiments.$inferInsert;

export type TrainingStatus = "queued" | "running" | "completed" | "failed" | "skipped";
export type ExperimentStatus = "active" | "completed" | "cancelled";

export const schema = { mlTrainingRuns, mlExperiments };
