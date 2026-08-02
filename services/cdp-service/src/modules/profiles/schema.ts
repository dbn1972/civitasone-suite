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

/**
 * CR-CDP-01 — per-tenant, per-vertical golden profile template.
 *
 * Two things a CDP cannot hard-code: which attributes a golden profile carries (a
 * hospital's profile is not a telecom's), and which source wins when two systems
 * disagree on the same attribute. Both live here as tenant configuration:
 * `attributesSpec` is the contract, `conflictRules` is the survivorship policy applied
 * per attribute, with `defaultStrategy`/`sourcePriority` as the fallback.
 */
export const profileTemplates = cdpSchema.table("profile_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  vertical: varchar("vertical", { length: 64 }).notNull(),
  profileType: varchar("profile_type", { length: 32 }).notNull().default("individual"),
  label: varchar("label", { length: 160 }).notNull(),
  attributesSpec: jsonb("attributes_spec").$type<Array<Record<string, unknown>>>().notNull().default([]),
  conflictRules: jsonb("conflict_rules").$type<Record<string, Record<string, unknown>>>().notNull().default({}),
  defaultStrategy: varchar("default_strategy", { length: 32 }).notNull().default("most_recent"),
  sourcePriority: jsonb("source_priority").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type ProfileTemplateRow = typeof profileTemplates.$inferSelect;
export type ProfileTemplateInsert = typeof profileTemplates.$inferInsert;

export const schema = { profiles, profileScores, profileTemplates };
