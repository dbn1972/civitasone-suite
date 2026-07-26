import {
  pgSchema, uuid, varchar, char, bigint, numeric, integer, date, text, timestamp,
} from "drizzle-orm/pg-core";

export const cpfSchema = pgSchema("cpf");

/** Contributory Provident Fund account — employee subscription + employer share. */
export const hrmsCpfAccounts = cpfSchema.table("hrms_cpf_accounts", {
  id:                       uuid("id").primaryKey().defaultRandom(),
  tenantId:                 uuid("tenant_id").notNull(),
  employeeId:               uuid("employee_id").notNull(),
  cpfNumber:                varchar("cpf_number", { length: 32 }).notNull(),
  openingEmpMinor:          bigint("opening_emp_minor", { mode: "bigint" }).notNull().default(0n),
  openingErMinor:           bigint("opening_er_minor", { mode: "bigint" }).notNull().default(0n),
  monthlySubscriptionMinor: bigint("monthly_subscription_minor", { mode: "bigint" }).notNull().default(0n),
  interestRatePct:          numeric("interest_rate_pct", { precision: 5, scale: 2 }).notNull().default("7.10"),
  status:                   varchar("status", { length: 16 }).notNull().default("active"),
  currency:                 char("currency", { length: 3 }).notNull().default("INR"),
  openedAt:                 date("opened_at").notNull().defaultNow(),
  createdAt:                timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:                timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:                uuid("created_by").notNull(),
  updatedBy:                uuid("updated_by").notNull(),
  version:                  integer("version").notNull().default(1),
});

export const hrmsCpfLedger = cpfSchema.table("hrms_cpf_ledger", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  accountId:       uuid("account_id").notNull(),
  employeeId:      uuid("employee_id").notNull(),
  entryType:       varchar("entry_type", { length: 16 }).notNull(),
  period:          char("period", { length: 7 }),
  empAmountMinor:  bigint("emp_amount_minor", { mode: "bigint" }).notNull().default(0n),
  erAmountMinor:   bigint("er_amount_minor", { mode: "bigint" }).notNull().default(0n),
  deltaMinor:      bigint("delta_minor", { mode: "bigint" }).notNull(),
  empBalanceMinor: bigint("emp_balance_minor", { mode: "bigint" }).notNull(),
  erBalanceMinor:  bigint("er_balance_minor", { mode: "bigint" }).notNull(),
  balanceMinor:    bigint("balance_minor", { mode: "bigint" }).notNull(),
  effectiveDate:   date("effective_date").notNull().defaultNow(),
  narrative:       text("narrative"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
});

export type CpfAccountRow = typeof hrmsCpfAccounts.$inferSelect;
export type CpfAccountInsert = typeof hrmsCpfAccounts.$inferInsert;
export type CpfLedgerRow = typeof hrmsCpfLedger.$inferSelect;
export type CpfLedgerInsert = typeof hrmsCpfLedger.$inferInsert;

export const cpfModuleSchema = { hrmsCpfAccounts, hrmsCpfLedger };
