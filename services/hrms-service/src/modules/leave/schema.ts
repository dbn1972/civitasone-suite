import {
  pgSchema, uuid, text, integer, char, varchar, boolean, date, timestamp, numeric, jsonb,
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
  // See migrations/0151_leave_type_lop_fraction.sql for the backfill of
  // existing types and the evidence behind each one.
  lopFractionBps: integer("lop_fraction_bps").notNull().default(10000),
  // S8-G3 (migration 0266): leave types are data. is_active hides a type from apply/allocate
  // while keeping its history; system_code links a tenant type to a built-in engine behaviour
  // (NULL = purely tenant-defined, resolved from the tenant's policy-rule rows).
  isActive:     boolean("is_active").notNull().default(true),
  systemCode:   varchar("system_code", { length: 8 }),
  category:     varchar("category", { length: 16 }),
  genderRestriction: varchar("gender_restriction", { length: 8 }),
  description:  text("description"),
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
  // GAP-HR-LEAVE-APPLY-05 (migration 0183): exact balance in 0.5-day units.
  // NULL = never fractionally touched; readers use effectiveBalanceDays().
  // balance_days keeps FLOOR(exact) as a safe whole-day shadow.
  balanceDaysExact: numeric("balance_days_exact", { precision: 6, scale: 1 }),
  // S8-G3 (migration 0266): an allocation is ENDED (soft), never deleted.
  status:       varchar("status", { length: 12 }).notNull().default("active"),
  endedOn:      date("ended_on", { mode: "string" }),
  endedReason:  text("ended_reason"),
  endedBy:      uuid("ended_by"),
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
  // GAP-HR-LEAVE-APPLY-05 (migration 0183): exact applied days in 0.5-day units
  // (NULL = whole-day row, use days_applied; days_applied = CEIL(exact) shadow).
  daysAppliedExact: numeric("days_applied_exact", { precision: 5, scale: 1 }),
  // 'full' | 'first_half' | 'second_half' | 'short_leave'
  dayPart:      varchar("day_part", { length: 16 }).notNull().default("full"),
  reason:       text("reason"),
  // W8 (migration 0265): the approver's reason when status = rejected.
  rejectionReason: text("rejection_reason"),
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

// GAP-HR-LEAVE-APPLY-05 (migration 0184): per-tenant half-day / short-leave
// switch. No row == both OFF (whole days only, the pre-existing behaviour).
export const hrmsLeaveTenantConfig = leaveSchema.table("hrms_leave_tenant_config", {
  tenantId:         uuid("tenant_id").primaryKey(),
  halfDayEnabled:   boolean("half_day_enabled").notNull().default(false),
  shortLeaveEnabled: boolean("short_leave_enabled").notNull().default(false),
  // S8-G3 (migration 0266): row-based leave resolver. Default OFF == the unchanged engine path.
  customLeaveRulesEnabled: boolean("custom_leave_rules_enabled").notNull().default(false),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});
export type LeaveTenantConfigRow = typeof hrmsLeaveTenantConfig.$inferSelect;

// V4-B-01 (migration 0252): persisted comp-off entitlements (was an in-memory array).
export const hrmsCompOff = leaveSchema.table("hrms_comp_off", {
  id:          uuid("id").primaryKey(),
  tenantId:    uuid("tenant_id").notNull(),
  employeeId:  uuid("employee_id").notNull(),
  workedDate:  date("worked_date", { mode: "string" }).notNull(),
  holidayName: text("holiday_name").notNull(),
  hours:       integer("hours").notNull(),
  reason:      text("reason").notNull().default(""),
  status:      text("status").notNull().default("available"),
  redeemedAt:  timestamp("redeemed_at", { withTimezone: true }),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});
export type CompOffRow = typeof hrmsCompOff.$inferSelect;

// S8-G3 (migration 0266): maker-checker request to deactivate a leave type (and end its allocations).
export const hrmsLeaveTypeChanges = leaveSchema.table("hrms_leave_type_changes", {
  id:            uuid("id").primaryKey(),
  tenantId:      uuid("tenant_id").notNull(),
  leaveTypeId:   uuid("leave_type_id").notNull(),
  allocId:       uuid("alloc_id"),
  action:        varchar("action", { length: 24 }).notNull(),
  status:        varchar("status", { length: 12 }).notNull().default("pending"),
  reason:        text("reason").notNull(),
  impact:        jsonb("impact").notNull().default({}),
  requestedBy:   uuid("requested_by").notNull(),
  decidedBy:     uuid("decided_by"),
  decidedAt:     timestamp("decided_at", { withTimezone: true }),
  decisionNote:  text("decision_note"),
  appliedSummary: jsonb("applied_summary"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});
export type LeaveTypeChangeRow = typeof hrmsLeaveTypeChanges.$inferSelect;

export const schema = { hrmsLeaveTypeChanges, hrmsLeaveTypes, hrmsLeaveAllocs, hrmsLeaveApps, hrmsLeaveConversions, hrmsLeaveTenantConfig, hrmsCompOff };
