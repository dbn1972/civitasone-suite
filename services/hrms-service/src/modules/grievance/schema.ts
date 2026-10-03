import { uuid, varchar, text, date, timestamp, integer, primaryKey } from "drizzle-orm/pg-core";
import { employeeSchema } from "../employee/schema.js";

/**
 * GAP-HR-GRIEVANCE-01/02/03/06: employee grievance register (migration 0177).
 * case_no is a per-tenant, per-year sequential number (GRV/YYYY/NNNN).
 */
export const hrmsGrievances = employeeSchema.table("hrms_grievances", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  caseNo:          varchar("case_no", { length: 24 }).notNull(),
  employeeId:      uuid("employee_id").notNull(),
  category:        varchar("category", { length: 32 }).notNull(),
  subject:         varchar("subject", { length: 200 }).notNull(),
  description:     text("description").notNull(),
  filedDate:       date("filed_date").notNull(),
  status:          varchar("status", { length: 16 }).notNull().default("registered"),
  /** hrms_employees.id of the HR officer the case is assigned to (opaque ref, no FK). */
  assignedTo:      uuid("assigned_to"),
  assignedAt:      timestamp("assigned_at", { withTimezone: true }),
  disposition:     varchar("disposition", { length: 24 }),
  disposalRemarks: text("disposal_remarks"),
  disposedAt:      timestamp("disposed_at", { withTimezone: true }),
  disposedBy:      uuid("disposed_by"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export const hrmsGrievanceEvents = employeeSchema.table("hrms_grievance_events", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  grievanceId: uuid("grievance_id").notNull(),
  action:      varchar("action", { length: 16 }).notNull(), // register | assign | dispose
  fromStatus:  varchar("from_status", { length: 16 }),
  toStatus:    varchar("to_status", { length: 16 }).notNull(),
  actorId:     uuid("actor_id").notNull(),
  assignedTo:  uuid("assigned_to"),
  note:        text("note"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Atomic per-(tenant, year) counter behind case_no. */
export const hrmsGrievanceSeq = employeeSchema.table("hrms_grievance_seq", {
  tenantId: uuid("tenant_id").notNull(),
  year:     integer("year").notNull(),
  nextVal:  integer("next_val").notNull().default(1),
}, (t) => ({ pk: primaryKey({ columns: [t.tenantId, t.year] }) }));

export type GrievanceRow = typeof hrmsGrievances.$inferSelect;
export type GrievanceInsert = typeof hrmsGrievances.$inferInsert;
export type GrievanceEventRow = typeof hrmsGrievanceEvents.$inferSelect;

export const schema = { hrmsGrievances, hrmsGrievanceEvents, hrmsGrievanceSeq };
