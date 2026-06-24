import {
  pgSchema, uuid, varchar, char, bigint, numeric, integer, date, text, timestamp,
} from "drizzle-orm/pg-core";

export const gpfSchema = pgSchema("gpf");

export const hrmsGpfAccounts = gpfSchema.table("hrms_gpf_accounts", {
  id:                       uuid("id").primaryKey().defaultRandom(),
  tenantId:                 uuid("tenant_id").notNull(),
  employeeId:               uuid("employee_id").notNull(),
  gpfNumber:                varchar("gpf_number", { length: 32 }).notNull(),
  openingBalanceMinor:      bigint("opening_balance_minor", { mode: "bigint" }).notNull().default(0n),
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

export const hrmsGpfLedger = gpfSchema.table("hrms_gpf_ledger", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  accountId:     uuid("account_id").notNull(),
  employeeId:    uuid("employee_id").notNull(),
  entryType:     varchar("entry_type", { length: 16 }).notNull(),
  amountMinor:   bigint("amount_minor", { mode: "bigint" }).notNull(),
  deltaMinor:    bigint("delta_minor", { mode: "bigint" }).notNull(),
  balanceMinor:  bigint("balance_minor", { mode: "bigint" }).notNull(),
  effectiveDate: date("effective_date").notNull().defaultNow(),
  narrative:     text("narrative"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
});

export type GpfAccountRow = typeof hrmsGpfAccounts.$inferSelect;
export type GpfAccountInsert = typeof hrmsGpfAccounts.$inferInsert;
export type GpfLedgerRow = typeof hrmsGpfLedger.$inferSelect;
export type GpfLedgerInsert = typeof hrmsGpfLedger.$inferInsert;

export const gpfModuleSchema = { hrmsGpfAccounts, hrmsGpfLedger };
