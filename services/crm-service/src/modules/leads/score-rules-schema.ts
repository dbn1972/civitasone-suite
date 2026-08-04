/**
 * LQ-002 — Drizzle schema for configurable lead scoring + score history.
 * Tables created via migration 0042. FORCE RLS + tenant policy.
 */
import { pgSchema, uuid, varchar, integer, boolean, jsonb, timestamp, text } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const leadScoreRules = crmSchema.table("lead_score_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  attribute: varchar("attribute", { length: 64 }).notNull(),
  weight: integer("weight").notNull().default(0),
  scoreFnType: varchar("score_fn_type", { length: 24 }).notNull().default("presence"),
  params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const leadScoreHistory = crmSchema.table("lead_score_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  leadId: uuid("lead_id").notNull(),
  score: integer("score").notNull(),
  previousScore: integer("previous_score"),
  factors: jsonb("factors").$type<Record<string, unknown>>().notNull().default({}),
  source: varchar("source", { length: 8 }).notNull().default("rule"),
  reason: text("reason"),
  scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LeadScoreRuleRow = typeof leadScoreRules.$inferSelect;
export type LeadScoreHistoryRow = typeof leadScoreHistory.$inferSelect;

export const schema = { leadScoreRules, leadScoreHistory };
