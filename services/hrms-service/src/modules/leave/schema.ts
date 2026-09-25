import {
  pgSchema, uuid, text, integer, char, varchar, boolean, date, timestamp,
} from "drizzle-orm/pg-core";

export const leaveSchema = pgSchema("leave");

export const hrmsLeaveTypes = leaveSchema.table("hrms_leave_types", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  code:         text("code").notNull(),
  name:         text("name").notNull(),
  maxDays:      integer("max_days").notNull().default(0),
  isEncashable: boolean("is_encashable").notNull().default(false),
  carryForward: boolean("carry_forward").notNull().default(false),
  // HIGH fix (LOP-ignores-leave-type bug): basis points (0-10000) of each
  // approved day of THIS leave type that counts toward payroll Loss-of-Pay.
  // 0 = fully paid (no LOP), 10000 = fully unpaid (full LOP), any value
  // between expresses a partially-paid type (e.g. CCS Half Pay Leave =
  // 5000, exactly half) -- a fraction field rather than a paid/unpaid
  // boolean, so a partially-paid type is expressible without another schema
  // change. Basis points (not a float/percent) to mirror this codebase's own
  // DA-rate convention (dearness_allowance_rates.rate_bps, employee/
  // consumer.ts's daRateBps) and keep every downstream computation in exact
  // integer arithmetic. Default 10000 (fully counts as LOP) is the fail-safe
  // for any future/custom leave type created without explicitly classifying
  // it -- mirrors engagement-policy.ts's attendanceLopApplies default-to-true
  // precedent (silently treating an unclassified type as paid risks a silent
  // overpayment that's hard to audit after the fact; docking it as unpaid by
  // default is at least immediately visible on the employee's payslip).
  // See migrations/0150_leave_type_lop_fraction.sql for the backfill of
  // existing types and the evidence behind each one.
  lopFractionBps: integer("lop_fraction_bps").notNull().default(10000),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export const hrmsLeaveAllocs = leaveSchema.table("hrms_leave_allocs", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  employeeId:   uuid("employee_id").notNull(),
  leaveTypeId:  uuid("leave_type_id").notNull(),
  fy:           char("fy", { length: 7 }).notNull(),
  totalDays:    integer("total_days").notNull().default(0),
  balanceDays:  integer("balance_days").notNull().default(0),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export const hrmsLeaveApps = leaveSchema.table("hrms_leave_apps", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  employeeId:   uuid("employee_id").notNull(),
  leaveTypeId:  uuid("leave_type_id").notNull(),
  allocId:      uuid("alloc_id").notNull(),
  fromDate:     date("from_date").notNull(),
  toDate:       date("to_date").notNull(),
  daysApplied:  integer("days_applied").notNull(),
  reason:       text("reason"),
  approvedBy:   uuid("approved_by"),
  status:       varchar("status", { length: 24 }).notNull().default("draft"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export type LeaveAppRow = typeof hrmsLeaveApps.$inferSelect;
export type LeaveAllocRow = typeof hrmsLeaveAllocs.$inferSelect;

// DEF-LM-001: leave-type conversion (e.g., HPL → commuted leave). Records
// which allocation was debited and which was credited.
export const hrmsLeaveConversions = leaveSchema.table("hrms_leave_conversions", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  employeeId:    uuid("employee_id").notNull(),
  fromAllocId:   uuid("from_alloc_id").notNull(),
  toAllocId:     uuid("to_alloc_id").notNull(),
  days:          integer("days").notNull(),
  reason:        text("reason"),
  status:        varchar("status", { length: 12 }).notNull().default("approved"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  version:       integer("version").notNull().default(1),
});
export type LeaveConversionRow = typeof hrmsLeaveConversions.$inferSelect;

export const schema = { hrmsLeaveTypes, hrmsLeaveAllocs, hrmsLeaveApps, hrmsLeaveConversions };
