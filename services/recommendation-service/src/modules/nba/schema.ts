/**
 * nba module — Recommendations served log schema.
 */
import { pgSchema, uuid, varchar, integer, timestamp, numeric } from "drizzle-orm/pg-core";

export const recommendationSchema = pgSchema("recommendation");

/** Log of recommendations served to profiles (Next Best Action). */
export const recommendations = recommendationSchema.table("recommendations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  profileId: uuid("profile_id").notNull(),
  recommendationType: varchar("recommendation_type", { length: 64 }).notNull(),
  productId: uuid("product_id"),
  /** Confidence/relevance score (0.0 – 1.0). */
  score: numeric("score", { precision: 5, scale: 4 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("served"),
  servedAt: timestamp("served_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type RecommendationRow = typeof recommendations.$inferSelect;
export type RecommendationInsert = typeof recommendations.$inferInsert;

export const schema = { recommendations };
