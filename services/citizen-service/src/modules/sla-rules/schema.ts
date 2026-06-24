import { pgSchema, uuid, varchar, integer, boolean, timestamp } from "drizzle-orm/pg-core";

/** P1-1: persisted SLA escalation rules (was an in-memory store). */
export const citizenSchema = pgSchema("citizen");

export const slaRules = citizenSchema.table("sla_rules", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  priority:        varchar("priority", { length: 16 }).notNull(),
  escalationHours: integer("escalation_hours").notNull(),
  escalateTo:      varchar("escalate_to", { length: 64 }).notNull(),
  isActive:        boolean("is_active").notNull().default(true),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SlaRuleRow    = typeof slaRules.$inferSelect;
export type SlaRuleInsert = typeof slaRules.$inferInsert;

export const schema = { slaRules };
