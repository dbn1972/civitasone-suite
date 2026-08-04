/**
 * LQ-001 — Drizzle schema for lead qualification frameworks. Tables created via
 * migration 0041. All in the `crm` Postgres schema, FORCE RLS + tenant policy.
 */
import { pgSchema, uuid, varchar, integer, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const qualificationFrameworks = crmSchema.table("qualification_frameworks", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  businessLine: varchar("business_line", { length: 64 }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const qualificationQuestions = crmSchema.table("qualification_questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  frameworkId: uuid("framework_id").notNull(),
  tenantId: uuid("tenant_id").notNull(),
  prompt: varchar("prompt", { length: 400 }).notNull(),
  answerType: varchar("answer_type", { length: 8 }).notNull().default("bool"),
  weight: integer("weight").notNull().default(0),
  outcomeRule: jsonb("outcome_rule").$type<Record<string, unknown>>().notNull().default({}),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const leadQualifications = crmSchema.table("lead_qualifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  leadId: uuid("lead_id").notNull(),
  frameworkId: uuid("framework_id").notNull(),
  answers: jsonb("answers").$type<Record<string, unknown>>().notNull().default({}),
  outcome: varchar("outcome", { length: 24 }).notNull(),
  score: integer("score").notNull().default(0),
  qualifiedBy: uuid("qualified_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type QualificationFrameworkRow = typeof qualificationFrameworks.$inferSelect;
export type QualificationQuestionRow = typeof qualificationQuestions.$inferSelect;
export type LeadQualificationRow = typeof leadQualifications.$inferSelect;

export const schema = { qualificationFrameworks, qualificationQuestions, leadQualifications };
