/**
 * leads module — Drizzle schema for assignment rules.
 * Lives in the `crm` Postgres schema.
 */
import { pgSchema, uuid, varchar, integer, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

/**
 * Assignment rules route new leads to owners based on configurable criteria.
 * Evaluated in ascending ordinal order; first match wins.
 */
export const assignmentRules = crmSchema.table("assignment_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  type: varchar("type", { length: 24 }).notNull(), // territory | round_robin | score_threshold
  criteria: jsonb("criteria").notNull(), // type-specific JSON
  ordinal: integer("ordinal").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type AssignmentRuleRow = typeof assignmentRules.$inferSelect;
export type AssignmentRuleInsert = typeof assignmentRules.$inferInsert;

export const schema = { assignmentRules };
