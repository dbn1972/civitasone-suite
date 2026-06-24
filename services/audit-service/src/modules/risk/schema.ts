import { pgSchema, uuid, text, integer, varchar, timestamp, date } from "drizzle-orm/pg-core";

export const riskSchema = pgSchema("risk");

export const auditRisks = riskSchema.table("audit_risks", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  riskCode:         text("risk_code").notNull(),
  title:            text("title").notNull(),
  category:         varchar("category", { length: 24 }).notNull().default("operational"),
  likelihood:       varchar("likelihood", { length: 24 }).notNull().default("possible"),
  impact:           varchar("impact", { length: 24 }).notNull().default("moderate"),
  riskScore:        integer("risk_score").notNull().default(0),
  ownerRef:         text("owner_ref"),
  mitigationStatus: varchar("mitigation_status", { length: 24 }).notNull().default("not_started"),
  reviewDate:       date("review_date"),
  status:           varchar("status", { length: 24 }).notNull().default("open"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

// P1-7: risk-driven audit planning — many-to-many link between an audit plan and the
// risk-register entities that justify auditing it. Drives the "audit universe".
export const auditPlanRisks = riskSchema.table("audit_plan_risks", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  planId:    uuid("plan_id").notNull(),
  riskId:    uuid("risk_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export type RiskRow    = typeof auditRisks.$inferSelect;
export type RiskInsert = typeof auditRisks.$inferInsert;
export type PlanRiskRow = typeof auditPlanRisks.$inferSelect;
export const schema = { auditRisks, auditPlanRisks };
