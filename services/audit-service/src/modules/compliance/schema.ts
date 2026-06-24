import { pgSchema, uuid, text, integer, bigint, varchar, timestamp, date, jsonb, boolean } from "drizzle-orm/pg-core";

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

/** P0-4: compliance checklists persisted to a real, tenant-scoped table (was an in-memory array). */
export const auditChecklists = complianceSchema.table("audit_checklists", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  title:       text("title").notNull(),
  description: text("description"),
  items:       jsonb("items").$type<string[]>().notNull().default([]),
  completed:   boolean("completed").notNull().default(false),
  completedBy: uuid("completed_by"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type PendingRegisterRow = typeof auditPendingRegister.$inferSelect;
export type ChecklistRow = typeof auditChecklists.$inferSelect;
export const schema = { auditComplianceReports, auditPendingRegister, auditChecklists };
