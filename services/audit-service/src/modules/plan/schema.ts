import { pgSchema, uuid, text, integer, varchar, timestamp, date } from "drizzle-orm/pg-core";

export const planSchema = pgSchema("plan");

export const auditPlans = planSchema.table("audit_plans", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  planNo:     text("plan_no").notNull(),
  title:      text("title").notNull(),
  area:       text("area").notNull(),
  periodFrom: date("period_from").notNull(),
  periodTo:   date("period_to").notNull(),
  riskLevel:  varchar("risk_level", { length: 16 }).notNull().default("medium"),
  status:     varchar("status", { length: 24 }).notNull().default("draft"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

export const auditPlanItems = planSchema.table("audit_plan_items", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  planId:        uuid("plan_id").notNull(),
  deptRef:       text("dept_ref").notNull(),
  unitRef:       text("unit_ref"),
  scheduledFrom: date("scheduled_from").notNull(),
  scheduledTo:   date("scheduled_to").notNull(),
  status:        varchar("status", { length: 24 }).notNull().default("scheduled"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export const auditTeams = planSchema.table("audit_teams", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  planId:     uuid("plan_id").notNull(),
  memberRef:  text("member_ref").notNull(),
  role:       varchar("role", { length: 32 }).notNull().default("auditor"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

export type PlanRow = typeof auditPlans.$inferSelect;
export type PlanInsert = typeof auditPlans.$inferInsert;
export const schema = { auditPlans, auditPlanItems, auditTeams };
