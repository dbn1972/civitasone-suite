/**
 * feedback module — Recommendation acceptance/rejection feedback schema.
 */
import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const recommendationSchema = pgSchema("recommendation");

/**
 * Feedback captured when a user acts on a served recommendation.
 * `reason` is mandatory at the domain layer when `action` is 'rejected' so the
 * model can be retrained on explicit rejection causes.
 */
export const recommendationFeedback = recommendationSchema.table("recommendation_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  recommendationId: uuid("recommendation_id").notNull(),
  /** 'accepted' | 'rejected'. */
  action: varchar("action", { length: 24 }).notNull(),
  /** Free-text rejection reason — required when action is 'rejected'. */
  reason: varchar("reason", { length: 500 }),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type RecommendationFeedbackRow = typeof recommendationFeedback.$inferSelect;
export type RecommendationFeedbackInsert = typeof recommendationFeedback.$inferInsert;

export const schema = { recommendationFeedback };
