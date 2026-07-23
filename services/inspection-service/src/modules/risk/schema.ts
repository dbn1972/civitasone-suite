/**
 * Risk module — Drizzle schema for risk models and computed risk scores.
 *
 * Validates: Requirements 3.1, 3.2, 3.3
 */
import { pgSchema, uuid, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const riskSchema = pgSchema("risk");

/**
 * Risk models define how entity risk scores are calculated.
 *
 * `factors` JSONB shape:
 * ```
 * { name: string; weight: number; scoringFunction: string; dataSource: string }[]
 * ```
 * Invariant: sum(factors[*].weight) === 1.0 (±0.001)
 */
export const riskModels = riskSchema.table("risk_models", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  factors: jsonb("factors").notNull(),
  isActive: integer("is_active").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

/**
 * Computed risk scores per entity and model.
 *
 * `factorBreakdown` JSONB shape:
 * ```
 * { factorName: string; rawScore: number; weightedScore: number }[]
 * ```
 *
 * `score` is an integer in the range 0–100.
 * `previousScore` stores the prior score (if any) for trend calculation.
 */
export const riskScores = riskSchema.table("risk_scores", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  entityId: uuid("entity_id").notNull(),
  modelId: uuid("model_id").notNull(),
  score: integer("score").notNull(),
  factorBreakdown: jsonb("factor_breakdown").notNull(),
  previousScore: integer("previous_score"),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
}, (t) => ({
  tenantEntity: index("idx_risk_scores_tenant_entity").on(t.tenantId, t.entityId),
}));

export type RiskModelRow = typeof riskModels.$inferSelect;
export type RiskModelInsert = typeof riskModels.$inferInsert;
export type RiskScoreRow = typeof riskScores.$inferSelect;
export type RiskScoreInsert = typeof riskScores.$inferInsert;

export const schema = { riskModels, riskScores };
