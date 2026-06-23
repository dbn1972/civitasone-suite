import {
  pgSchema, uuid, integer, char, varchar, timestamp,
} from "drizzle-orm/pg-core";

export const payrollSchema = pgSchema("payroll");

export const payrollLopLedger = payrollSchema.table("payroll_lop_ledger", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tenantId:   uuid("tenant_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  month:      char("month", { length: 7 }).notNull(),
  lopDays:    integer("lop_days").notNull().default(0),
  source:     varchar("source", { length: 32 }).notNull(),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schema = { payrollLopLedger };
