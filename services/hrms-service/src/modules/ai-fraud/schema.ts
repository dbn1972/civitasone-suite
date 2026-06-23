import { pgSchema, uuid, varchar, integer, numeric, boolean, text, jsonb, timestamp } from "drizzle-orm/pg-core";

const empSchema = pgSchema("employee");

export const hrmsFraudAlerts = empSchema.table("hrms_fraud_alerts", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  alertType:       varchar("alert_type", { length: 64 }).notNull(),
  severity:        varchar("severity", { length: 12 }).notNull().default("medium"),
  employeeId:      uuid("employee_id"),
  description:     text("description").notNull(),
  evidence:        jsonb("evidence").notNull().default({}),
  riskScore:       numeric("risk_score", { precision: 5, scale: 4 }).notNull().default("0"),
  mlModel:         varchar("ml_model", { length: 64 }),
  status:          varchar("status", { length: 16 }).notNull().default("open"),
  assignedTo:      uuid("assigned_to"),
  resolvedBy:      uuid("resolved_by"),
  resolvedAt:      timestamp("resolved_at", { withTimezone: true }),
  resolutionNotes: text("resolution_notes"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const hrmsEmployeeRiskScores = empSchema.table("hrms_employee_risk_scores", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  employeeId:      uuid("employee_id").notNull(),
  overallRisk:     numeric("overall_risk", { precision: 5, scale: 4 }).notNull().default("0"),
  attendanceRisk:  numeric("attendance_risk", { precision: 5, scale: 4 }).notNull().default("0"),
  leaveRisk:       numeric("leave_risk", { precision: 5, scale: 4 }).notNull().default("0"),
  payrollRisk:     numeric("payroll_risk", { precision: 5, scale: 4 }).notNull().default("0"),
  attritionRisk:   numeric("attrition_risk", { precision: 5, scale: 4 }).notNull().default("0"),
  lastComputedAt:  timestamp("last_computed_at", { withTimezone: true }).notNull().defaultNow(),
  factors:         jsonb("factors").notNull().default([]),
});

export const hrmsRecommendations = empSchema.table("hrms_recommendations", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  employeeId:      uuid("employee_id"),
  category:        varchar("category", { length: 32 }).notNull(),
  title:           varchar("title", { length: 256 }).notNull(),
  description:     text("description").notNull(),
  priority:        varchar("priority", { length: 8 }).notNull().default("medium"),
  actionUrl:       varchar("action_url", { length: 512 }),
  isRead:          boolean("is_read").notNull().default(false),
  isActioned:      boolean("is_actioned").notNull().default(false),
  expiresAt:       timestamp("expires_at", { withTimezone: true }),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
