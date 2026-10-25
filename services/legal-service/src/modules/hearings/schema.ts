import { pgSchema, uuid, text, integer, varchar, timestamp, date, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const hearingsSchema = pgSchema("hearings");

export const legalHearings = hearingsSchema.table("legal_hearings", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  caseId:       uuid("case_id").notNull(),
  hearingDate:  date("hearing_date").notNull(),
  court:        text("court").notNull(),
  purpose:      text("purpose"),
  status:       varchar("status", { length: 24 }).notNull().default("scheduled"),
  nextDate:     date("next_date"),
  previousDate: date("previous_date"),
  reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
  departmentId: uuid("department_id"),
  assignedTo:   uuid("assigned_to"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
}, (t) => ({
  // CLOS3-S5-15 (migration 0029): at most one e-Courts-synced hearing per case+date.
  // Partial on the sync's system actor so user-recorded hearings stay unconstrained.
  ecourtsSyncUnique: uniqueIndex("uq_legal_hearings_ecourts_sync")
    .on(t.tenantId, t.caseId, t.hearingDate)
    .where(sql`created_by = '00000000-0000-4000-8000-000000000000'`),
}));

export const legalOrders = hearingsSchema.table("legal_orders", {
  id:        uuid("id").primaryKey().defaultRandom(),
  tenantId:  uuid("tenant_id").notNull(),
  caseId:    uuid("case_id").notNull(),
  orderType: varchar("order_type", { length: 32 }).notNull(),
  direction: text("direction"),
  deptRef:   text("dept_ref"),
  summary:   text("summary").notNull(),
  orderDate: date("order_date").notNull(),
  complianceRequired: boolean("compliance_required").notNull().default(false),
  complianceDeadline: date("compliance_deadline"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version:   integer("version").notNull().default(1),
});

export const legalOpinions = hearingsSchema.table("legal_opinions", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  opinionNo:   text("opinion_no").notNull(),
  subject:     text("subject").notNull(),
  requestedBy: text("requested_by").notNull(),
  requestDate: date("request_date").notNull(),
  dueDate:     date("due_date"),
  advisorName: text("advisor_name"),
  status:      varchar("status", { length: 24 }).notNull().default("pending"),
  issuedDate:  date("issued_date"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export type HearingRow = typeof legalHearings.$inferSelect;
export const schema = { legalHearings, legalOrders, legalOpinions };
