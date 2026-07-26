import {
  pgSchema, uuid, varchar, char, bigint, numeric, integer, date, text, timestamp,
} from "drizzle-orm/pg-core";

export const npsSchema = pgSchema("nps");

/** Individual NPS account keyed by PRAN (Permanent Retirement Account Number). */
export const hrmsNpsAccounts = npsSchema.table("hrms_nps_accounts", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  employeeId:      uuid("employee_id").notNull(),
  pran:            varchar("pran", { length: 20 }).notNull(),
  tier:            varchar("tier", { length: 2 }).notNull().default("I"),
  openingEmpMinor: bigint("opening_emp_minor", { mode: "bigint" }).notNull().default(0n),
  openingErMinor:  bigint("opening_er_minor", { mode: "bigint" }).notNull().default(0n),
  empContribPct:   numeric("emp_contrib_pct", { precision: 5, scale: 2 }).notNull().default("10.00"),
  erContribPct:    numeric("er_contrib_pct", { precision: 5, scale: 2 }).notNull().default("14.00"),
  status:          varchar("status", { length: 16 }).notNull().default("active"),
  currency:        char("currency", { length: 3 }).notNull().default("INR"),
  openedAt:        date("opened_at").notNull().defaultNow(),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export const hrmsNpsContributions = npsSchema.table("hrms_nps_contributions", {
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

export type NpsAccountRow = typeof hrmsNpsAccounts.$inferSelect;
export type NpsAccountInsert = typeof hrmsNpsAccounts.$inferInsert;
export type NpsContribRow = typeof hrmsNpsContributions.$inferSelect;
export type NpsContribInsert = typeof hrmsNpsContributions.$inferInsert;

export const npsModuleSchema = { hrmsNpsAccounts, hrmsNpsContributions };
