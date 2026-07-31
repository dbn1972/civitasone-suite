/**
 * eligibility module — Drizzle schema. Eligibility rules engine for product access control.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const catalogueSchema = pgSchema("catalogue");

export const eligibilityRules = catalogueSchema.table("eligibility_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  productId: uuid("product_id").notNull(),
  ruleType: varchar("rule_type", { length: 64 }).notNull(),
  criteria: jsonb("criteria").$type<Record<string, unknown>>().notNull().default({}),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type EligibilityRuleRow = typeof eligibilityRules.$inferSelect;
export type EligibilityRuleInsert = typeof eligibilityRules.$inferInsert;

export const schema = { eligibilityRules };
