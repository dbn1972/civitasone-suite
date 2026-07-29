import {
  pgSchema, uuid, text, integer, char, varchar, date, time, timestamp,
} from "drizzle-orm/pg-core";

export const attendanceSchema = pgSchema("attendance");

export const hrmsShifts = attendanceSchema.table("hrms_shifts", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  name:       text("name").notNull(),
  startTime:  time("start_time").notNull(),
  endTime:    time("end_time").notNull(),
  graceMins:  integer("grace_mins").notNull().default(0),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

export const hrmsShiftAssignments = attendanceSchema.table("hrms_shift_assignments", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  employeeId:    uuid("employee_id").notNull(),
  shiftId:       uuid("shift_id").notNull(),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo:   date("effective_to"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export const hrmsAttendance = attendanceSchema.table("hrms_attendance", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  employeeId:     uuid("employee_id").notNull(),
  attendanceDate: date("attendance_date").notNull(),
  status:         varchar("status", { length: 24 }).notNull().default("present"),
  inTime:         time("in_time"),
  outTime:        time("out_time"),
  shiftId:        uuid("shift_id"),
  lateMins:       integer("late_mins").notNull().default(0),
  source:         varchar("source", { length: 32 }).notNull().default("manual"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export const hrmsAttendanceRegularisations = attendanceSchema.table("hrms_attendance_regularisations", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  employeeId:      uuid("employee_id").notNull(),
  date:            date("date").notNull(),
  reason:          text("reason").notNull(),
  requestedStatus: varchar("requested_status", { length: 32 }).notNull().default("present"),
  status:          varchar("status", { length: 24 }).notNull().default("pending"),
  requestedAt:     timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

// DEF-AT-001 (T&A-ATM-0247): payroll cut-off / attendance period lock. One row
// per (tenant, period YYYY-MM). status='locked' blocks attendance writes for that
// month until re-opened.
export const hrmsAttendanceLocks = attendanceSchema.table("hrms_attendance_locks", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  period:     char("period", { length: 7 }).notNull(),
  status:     varchar("status", { length: 8 }).notNull().default("locked"),
  reason:     text("reason"),
  lockedBy:   uuid("locked_by"),
  lockedAt:   timestamp("locked_at", { withTimezone: true }),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:  uuid("created_by").notNull(),
  updatedBy:  uuid("updated_by").notNull(),
  version:    integer("version").notNull().default(1),
});

export type AttendanceRow = typeof hrmsAttendance.$inferSelect;
export type AttendanceInsert = typeof hrmsAttendance.$inferInsert;
export type RegularisationRow = typeof hrmsAttendanceRegularisations.$inferSelect;
export type RegularisationInsert = typeof hrmsAttendanceRegularisations.$inferInsert;
export type AttendanceLockRow = typeof hrmsAttendanceLocks.$inferSelect;

export const schema = { hrmsShifts, hrmsShiftAssignments, hrmsAttendance, hrmsAttendanceRegularisations, hrmsAttendanceLocks };
