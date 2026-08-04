/**
 * leads module — configurable lead field rules (LM-001).
 *
 * One row per (tenant, field) declaring whether the guided lead form must have
 * that field filled in, and how much it contributes to the completeness score.
 * A tenant with no rows keeps the built-in behaviour, so this is opt-in.
 */
import { pgSchema, uuid, varchar, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const leadFieldRules = crmSchema.table("lead_field_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  /** Constrained in SQL to the fields the guided lead form actually collects. */
  fieldName: varchar("field_name", { length: 64 }).notNull(),
  required: boolean("required").notNull().default(false),
  /**
   * Relative contribution to the 0–100 completeness score. 0 is the DB default and
   * means "unweighted": if a tenant sets no weights at all, every enabled rule is
   * scored equally (see resolveWeights) rather than not scored — otherwise declaring a
   * field mandatory would leave it invisible to the data-quality score.
   */
  weight: integer("weight").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type LeadFieldRuleRow = typeof leadFieldRules.$inferSelect;
export type LeadFieldRuleInsert = typeof leadFieldRules.$inferInsert;

export interface LeadFieldRuleView {
  id: string;
  tenantId: string;
  fieldName: string;
  required: boolean;
  weight: number;
  enabled: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const schema = { leadFieldRules };
