import { pgSchema, uuid, varchar, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const stageSLAPolicies = crmSchema.table("stage_sla_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  stageCode: varchar("stage_code", { length: 60 }).notNull(),
  slaHours: integer("sla_hours").notNull(),
  warnAtPercent: integer("warn_at_percent").notNull().default(80),
  breachAction: varchar("breach_action", { length: 12 }).notNull().default("notify"),
  notifyRoles: jsonb("notify_roles").$type<string[]>().notNull().default([]),
  escalationTargetId: uuid("escalation_target_id"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type StageSLAPolicyRow = typeof stageSLAPolicies.$inferSelect;

export const schema = { stageSLAPolicies };
