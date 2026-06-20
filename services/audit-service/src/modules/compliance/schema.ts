import { pgSchema, uuid, text, integer, bigint, varchar, timestamp, date } from "drizzle-orm/pg-core";

export const complianceSchema = pgSchema("compliance");

export const auditComplianceReports = complianceSchema.table("audit_compliance_reports", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  reportNo:   text("report_no").notNull(),
  periodFrom: date("period_from").notNull(),
  periodTo:   date("period_to").notNull(),
  summary:    text("summary").notNull(),
  status:     varchar("status", { length: 24 }).notNull().default("draft"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

export const auditPendingRegister = complianceSchema.table("audit_pending_register", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  paraId:              uuid("para_id").notNull(),
  deptRef:             text("dept_ref").notNull(),
  amountInvolvedMinor: bigint("amount_involved_minor", { mode: "bigint" }).notNull().default(0n),
  status:              varchar("status", { length: 24 }).notNull().default("pending"),
  dueDate:             date("due_date"),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid("created_by").notNull(),
  updatedBy:           uuid("updated_by").notNull(),
  version:             integer("version").notNull().default(1),
});

export type PendingRegisterRow = typeof auditPendingRegister.$inferSelect;
export const schema = { auditComplianceReports, auditPendingRegister };
