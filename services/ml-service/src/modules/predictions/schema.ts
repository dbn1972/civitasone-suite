/**
 * predictions module — Drizzle schema for the ML prediction fact table.
 * Stores every prediction made (for audit, evaluation, and feedback tracking).
 * Includes outcome tracking fields for measuring model accuracy over time.
 *
 * Validates: Requirements 5.1
 */
import { pgSchema, uuid, text, timestamp, jsonb, boolean, numeric, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { mlModels } from "../models/schema.js";

export const mlSchema = pgSchema("ml");

export const mlPredictions = mlSchema.table("ml_predictions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  domain: text("domain").notNull(),
  entityId: uuid("entity_id").notNull(),
  modelId: uuid("model_id").references(() => mlModels.id),
  experimentId: text("experiment_id"),
  prediction: numeric("prediction", { precision: 5, scale: 4 }),
  confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
  factors: jsonb("factors").notNull().default([]),
  isFallback: boolean("is_fallback").notNull().default(false),
  fallbackReason: text("fallback_reason"),
  actualOutcome: text("actual_outcome"),
  userDecision: text("user_decision"),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantDomainEntity: index("idx_ml_predictions_tenant_domain_entity").on(t.tenantId, t.domain, t.entityId),
  createdAtDesc: index("idx_ml_predictions_created_at").on(t.createdAt).where(sql`true`),
}));

export type MlPredictionRow = typeof mlPredictions.$inferSelect;
export type MlPredictionInsert = typeof mlPredictions.$inferInsert;

export const schema = { mlPredictions };
