/**
 * profiles module — Drizzle schema. Golden profile store for identity resolution.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb, numeric } from "drizzle-orm/pg-core";

export const cdpSchema = pgSchema("cdp");

export const profiles = cdpSchema.table("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  profileType: varchar("profile_type", { length: 32 }).notNull().default("individual"),
  attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
  sourceLineage: jsonb("source_lineage").$type<Array<{ source: string; sourceId: string; timestamp: string }>>().notNull().default([]),
  mergedFromIds: jsonb("merged_from_ids").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ProfileRow = typeof profiles.$inferSelect;
export type ProfileInsert = typeof profiles.$inferInsert;

/**
 * CDP-009 — predictive scores written by ml-service.
 * `score` is numeric(6,4), not a float: scores are thresholded (e.g. churn > 0.7000)
 * and a binary float would drift across a write/read round-trip. postgres-js
 * surfaces numeric as a string and the API keeps it that way.
 */
export const profileScores = cdpSchema.table("profile_scores", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  profileId: uuid("profile_id").notNull(),
  scoreType: varchar("score_type", { length: 64 }).notNull(),
  score: numeric("score", { precision: 6, scale: 4 }).notNull(),
  modelVersion: varchar("model_version", { length: 64 }).notNull().default("unknown"),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export type ProfileScoreRow = typeof profileScores.$inferSelect;
export type ProfileScoreInsert = typeof profileScores.$inferInsert;

export const schema = { profiles, profileScores };
