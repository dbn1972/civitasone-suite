/**
 * Onboarding health metric framework — Drizzle schema (G19).
 *
 * `onboarding_health_rules`: per-tenant configurable milestone expectations.
 * `onboarding_health_scores`: computed composite score per onboarding case.
 */
import { pgSchema, uuid, varchar, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const onboardingHealthRules = crmSchema.table("onboarding_health_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  ruleKey: varchar("rule_key", { length: 64 }).notNull(),
  milestoneEvent: varchar("milestone_event", { length: 64 }).notNull(),
  expectedWithinDays: integer("expected_within_days").notNull(),
  weight: integer("weight").notNull().default(50),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
});

export const onboardingHealthScores = crmSchema.table("onboarding_health_scores", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  caseId: uuid("case_id").notNull(),
  score: integer("score").notNull(),
  milestonesHit: jsonb("milestones_hit").notNull().default([]),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HealthRuleRow = typeof onboardingHealthRules.$inferSelect;
export type HealthRuleInsert = typeof onboardingHealthRules.$inferInsert;
export type HealthScoreRow = typeof onboardingHealthScores.$inferSelect;
export type HealthScoreInsert = typeof onboardingHealthScores.$inferInsert;

export interface HealthRuleView {
  id: string;
  tenantId: string;
  ruleKey: string;
  milestoneEvent: string;
  expectedWithinDays: number;
  weight: number;
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface HealthScoreView {
  id: string;
  tenantId: string;
  caseId: string;
  score: number;
  milestonesHit: MilestoneResult[];
  computedAt: string;
  version: number;
}

export interface MilestoneResult {
  ruleKey: string;
  milestoneEvent: string;
  hit: boolean;
  overdue: boolean;
  weight: number;
}

export const schema = { onboardingHealthRules, onboardingHealthScores };
