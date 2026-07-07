import { pgSchema, uuid, text, integer, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";

export const limitationsSchema = pgSchema("limitations");

/**
 * limitation_rules — tracks statutory limitation rules per matter.
 * Each rule has a computed deadline and scheduled notification dates (stored as JSONB).
 */
export const limitationRules = limitationsSchema.table("limitation_rules", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  matterId:      uuid("matter_id").notNull(),
  ruleType:      varchar("rule_type", { length: 64 }).notNull(),
  startDate:     timestamp("start_date", { withTimezone: true }).notNull(),
  periodDays:    integer("period_days").notNull(),
  deadline:      timestamp("deadline", { withTimezone: true }).notNull(),
  status:        varchar("status", { length: 24 }).notNull().default("active"),
  notifications: jsonb("notifications"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export type LimitationRuleRow = typeof limitationRules.$inferSelect;
export type LimitationRuleInsert = typeof limitationRules.$inferInsert;
export const schema = { limitationRules };
