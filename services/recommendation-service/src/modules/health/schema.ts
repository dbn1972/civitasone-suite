/**
 * health module — Account health score schema.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb, numeric } from "drizzle-orm/pg-core";

export const recommendationSchema = pgSchema("recommendation");

/** Account health scores — computed metrics for relationship health. */
export const healthScores = recommendationSchema.table("health_scores", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  accountId: uuid("account_id").notNull(),
  /** Health score (0–100). */
  score: integer("score").notNull(),
  /** Contributing factors with individual weights/scores. */
  factors: jsonb("factors").$type<Record<string, unknown>>().notNull().default({}),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type HealthScoreRow = typeof healthScores.$inferSelect;
export type HealthScoreInsert = typeof healthScores.$inferInsert;

export const schema = { healthScores };
