import { pgSchema, uuid, text, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import type { EligibilityRule, RuleReason } from "./domain.js";

export const eligibilitySchema = pgSchema("eligibility");

export const eligibilityRuleSets = eligibilitySchema.table("rule_sets", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  serviceId:   uuid("service_id").notNull(),
  name:        text("name").notNull(),
  version:     integer("version").notNull().default(1),
  status:      varchar("status", { length: 16 }).notNull().default("draft"),
  rules:       jsonb("rules").$type<EligibilityRule[]>().notNull().default([]),
  submittedBy: uuid("submitted_by"),
  publishedBy: uuid("published_by"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  rowVersion:  integer("row_version").notNull().default(1),
});

export const eligibilityEvaluations = eligibilitySchema.table("evaluations", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  ruleSetId:      uuid("rule_set_id").notNull(),
  applicationId:  uuid("application_id"),
  subjectRef:     uuid("subject_ref"),
  subject:        jsonb("subject").$type<Record<string, unknown>>().notNull().default({}),
  outcome:        varchar("outcome", { length: 16 }).notNull(),
  reasons:        jsonb("reasons").$type<RuleReason[]>().notNull().default([]),
  reviewStatus:   varchar("review_status", { length: 16 }).notNull().default("none"),
  reviewDecision: varchar("review_decision", { length: 16 }),
  reviewNote:     text("review_note"),
  reviewedBy:     uuid("reviewed_by"),
  reviewedAt:     timestamp("reviewed_at", { withTimezone: true }),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  rowVersion:     integer("row_version").notNull().default(1),
});

export type RuleSetRow        = typeof eligibilityRuleSets.$inferSelect;
export type RuleSetInsert     = typeof eligibilityRuleSets.$inferInsert;
export type EvaluationRow     = typeof eligibilityEvaluations.$inferSelect;
export type EvaluationInsert  = typeof eligibilityEvaluations.$inferInsert;

export const schema = { eligibilityRuleSets, eligibilityEvaluations };
