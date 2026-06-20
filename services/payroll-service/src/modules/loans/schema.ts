import {
  pgSchema, uuid, text, integer, bigint, char, varchar, numeric, timestamp,
} from "drizzle-orm/pg-core";

export const loansSchema = pgSchema("loans");

export const payrollLoans = loansSchema.table("payroll_loans", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  loanNo:           text("loan_no").notNull(),
  employeeId:       uuid("employee_id").notNull(),
  loanType:         varchar("loan_type", { length: 32 }).notNull().default("personal"),
  principalMinor:   bigint("principal_minor", { mode: "bigint" }).notNull().default(0n),
  outstandingMinor: bigint("outstanding_minor", { mode: "bigint" }).notNull().default(0n),
  emiMinor:         bigint("emi_minor", { mode: "bigint" }).notNull().default(0n),
  tenureMonths:     integer("tenure_months").notNull().default(0),
  interestRatePct:  numeric("interest_rate_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  currency:         char("currency", { length: 3 }).notNull().default("INR"),
  disbursedAt:      timestamp("disbursed_at", { withTimezone: true }),
  status:           varchar("status", { length: 24 }).notNull().default("applied"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

export const payrollLoanRepayments = loansSchema.table("payroll_loan_repayments", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  loanId:          uuid("loan_id").notNull(),
  runId:           uuid("run_id"),
  installmentNo:   integer("installment_no").notNull(),
  principalMinor:  bigint("principal_minor", { mode: "bigint" }).notNull().default(0n),
  interestMinor:   bigint("interest_minor", { mode: "bigint" }).notNull().default(0n),
  totalMinor:      bigint("total_minor", { mode: "bigint" }).notNull().default(0n),
  currency:        char("currency", { length: 3 }).notNull().default("INR"),
  status:          varchar("status", { length: 24 }).notNull().default("pending"),
  paidAt:          timestamp("paid_at", { withTimezone: true }),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export type LoanRow = typeof payrollLoans.$inferSelect;

export const schema = { payrollLoans, payrollLoanRepayments };
