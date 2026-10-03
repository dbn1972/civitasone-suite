import {
  pgSchema, uuid, integer, char, varchar, timestamp, numeric,
} from "drizzle-orm/pg-core";

export const payrollSchema = pgSchema("payroll");

export const payrollLopLedger = payrollSchema.table("payroll_lop_ledger", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  month:      char("month", { length: 7 }).notNull(),
  lopDays:    integer("lop_days").notNull().default(0),
  // GAP-HR-LEAVE-APPLY-05 (migration 0064): exact LOP days (2 decimals) once a
  // part-day leave has landed; NULL = whole-day-only row. lop_days then holds
  // FLOOR(exact). Readers use COALESCE(lop_days_exact, lop_days).
  lopDaysExact: numeric("lop_days_exact", { precision: 7, scale: 2 }),
  source:     varchar("source", { length: 32 }).notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schema = { payrollLopLedger };
