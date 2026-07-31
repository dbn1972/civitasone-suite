import { pgSchema, uuid, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

const domainSchema = pgSchema("ai_agent");

/** Tenant-configurable guardrail rules evaluated on every inbound AI prompt. */
export const guardrailRules = domainSchema.table("guardrail_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  /** one of: pii | profanity | prompt_injection | topic_block | max_length */
  ruleType: varchar("rule_type", { length: 32 }).notNull(),
  pattern: varchar("pattern", { length: 500 }),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  /** one of: low | medium | high | critical */
  severity: varchar("severity", { length: 16 }).notNull().default("medium"),
  /** one of: active | disabled */
  status: varchar("status", { length: 16 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type GuardrailRuleRow = typeof guardrailRules.$inferSelect;
export type GuardrailRuleInsert = typeof guardrailRules.$inferInsert;

export const schema = { guardrailRules };
