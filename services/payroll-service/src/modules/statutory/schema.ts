import {
  pgSchema, uuid, integer, bigint, char, varchar, numeric, timestamp, date,
} from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";

export const statutorySchema = pgSchema("statutory");

export const payrollPf = statutorySchema.table("payroll_pf", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  slipId:            uuid("slip_id").notNull(),
  employeeId:        uuid("employee_id").notNull(),
  runId:             uuid("run_id").notNull(),
  basicMinor:        bigint("basic_minor", { mode: "bigint" }).notNull().default(0n),
  empContribPct:     numeric("emp_contrib_pct", { precision: 5, scale: 2 }).notNull().default("12"),
  erContribPct:      numeric("er_contrib_pct", { precision: 5, scale: 2 }).notNull().default("12"),
  empContribMinor:   bigint("emp_contrib_minor", { mode: "bigint" }).notNull().default(0n),
  erContribMinor:    bigint("er_contrib_minor", { mode: "bigint" }).notNull().default(0n),
  epsContribMinor:   bigint("eps_contrib_minor", { mode: "bigint" }).notNull().default(0n),
  epfErContribMinor: bigint("epf_er_contrib_minor", { mode: "bigint" }).notNull().default(0n),
  currency:          char("currency", { length: 3 }).notNull().default("INR"),
  period:            char("period", { length: 7 }).notNull(),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:         uuid("created_by").notNull(),
  updatedBy:         uuid("updated_by").notNull(),
  version:           integer("version").notNull().default(1),
});

export const payrollEsi = statutorySchema.table("payroll_esi", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  slipId:           uuid("slip_id").notNull(),
  employeeId:       uuid("employee_id").notNull(),
  runId:            uuid("run_id").notNull(),
  grossMinor:       bigint("gross_minor", { mode: "bigint" }).notNull().default(0n),
  empContribMinor:  bigint("emp_contrib_minor", { mode: "bigint" }).notNull().default(0n),
  erContribMinor:   bigint("er_contrib_minor", { mode: "bigint" }).notNull().default(0n),
  currency:         char("currency", { length: 3 }).notNull().default("INR"),
  period:           char("period", { length: 7 }).notNull(),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

export const payrollTds = statutorySchema.table("payroll_tds", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  slipId:           uuid("slip_id").notNull(),
  employeeId:       uuid("employee_id").notNull(),
  runId:            uuid("run_id").notNull(),
  annualBasicMinor: bigint("annual_basic_minor", { mode: "bigint" }).notNull().default(0n),
  taxableMinor:     bigint("taxable_minor", { mode: "bigint" }).notNull().default(0n),
  tdsMinor:         bigint("tds_minor", { mode: "bigint" }).notNull().default(0n),
  currency:         char("currency", { length: 3 }).notNull().default("INR"),
  period:           char("period", { length: 7 }).notNull(),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

export const payrollGratuity = statutorySchema.table("payroll_gratuity", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  employeeId:      uuid("employee_id").notNull(),
  separationRef:   varchar("separation_ref", { length: 128 }).notNull(),
  yearsOfService:  numeric("years_of_service", { precision: 5, scale: 2 }).notNull().default("0"),
  lastBasicMinor:  bigint("last_basic_minor", { mode: "bigint" }).notNull().default(0n),
  gratuityMinor:   bigint("gratuity_minor", { mode: "bigint" }).notNull().default(0n),
  currency:        char("currency", { length: 3 }).notNull().default("INR"),
  status:          varchar("status", { length: 24 }).notNull().default("computed"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export const payrollGpf = statutorySchema.table("payroll_gpf", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  slipId:           uuid("slip_id").notNull(),
  employeeId:       uuid("employee_id").notNull(),
  runId:            uuid("run_id").notNull(),
  basicMinor:       bigint("basic_minor", { mode: "bigint" }).notNull().default(0n),
  contribPct:       numeric("contrib_pct", { precision: 5, scale: 2 }).notNull().default("10"),
  empContribMinor:  bigint("emp_contrib_minor", { mode: "bigint" }).notNull().default(0n),
  currency:         char("currency", { length: 3 }).notNull().default("INR"),
  period:           char("period", { length: 7 }).notNull(),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

export const payrollNps = statutorySchema.table("payroll_nps", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  slipId:           uuid("slip_id").notNull(),
  employeeId:       uuid("employee_id").notNull(),
  runId:            uuid("run_id").notNull(),
  basicMinor:       bigint("basic_minor", { mode: "bigint" }).notNull().default(0n),
  empContribPct:    numeric("emp_contrib_pct", { precision: 5, scale: 2 }).notNull().default("10"),
  erContribPct:     numeric("er_contrib_pct", { precision: 5, scale: 2 }).notNull().default("14"),
  empContribMinor:  bigint("emp_contrib_minor", { mode: "bigint" }).notNull().default(0n),
  erContribMinor:   bigint("er_contrib_minor", { mode: "bigint" }).notNull().default(0n),
  currency:         char("currency", { length: 3 }).notNull().default("INR"),
  period:           char("period", { length: 7 }).notNull(),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});


export const payrollTdsChallan = statutorySchema.table("payroll_tds_challan", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  period:           char("period", { length: 7 }).notNull(),
  section:          varchar("section", { length: 8 }).notNull().default("192"),
  formType:         varchar("form_type", { length: 4 }).notNull().default("24Q"),
  bsrCode:          varchar("bsr_code", { length: 7 }).notNull(),
  challanSerial:    varchar("challan_serial", { length: 16 }).notNull(),
  depositDate:      date("deposit_date").notNull(),
  cin:              varchar("cin", { length: 32 }).notNull(),
  tdsAmountMinor:   bigint("tds_amount_minor", { mode: "bigint" }).notNull().default(0n),
  totalAmountMinor: bigint("total_amount_minor", { mode: "bigint" }).notNull().default(0n),
  interestMinor:    bigint("interest_minor", { mode: "bigint" }).notNull().default(0n),
  feeMinor:         bigint("fee_minor", { mode: "bigint" }).notNull().default(0n),
  status:           varchar("status", { length: 16 }).notNull().default("ingested"),
  currency:         char("currency", { length: 3 }).notNull().default("INR"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  version:          integer("version").notNull().default(1),
});

export const payrollTdsNonSalary = statutorySchema.table("payroll_tds_nonsalary", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  period:           char("period", { length: 7 }).notNull(),
  deducteeRef:      varchar("deductee_ref", { length: 64 }).notNull(),
  deducteeName:     varchar("deductee_name", { length: 255 }).notNull().default(""),
  deducteePan:      encryptedText("deductee_pan").notNull().default(""),
  section:          varchar("section", { length: 8 }).notNull(),
  paidAmountMinor:  bigint("paid_amount_minor", { mode: "bigint" }).notNull().default(0n),
  tdsRatePct:       numeric("tds_rate_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  tdsAmountMinor:   bigint("tds_amount_minor", { mode: "bigint" }).notNull().default(0n),
  deductionDate:    date("deduction_date"),
  currency:         char("currency", { length: 3 }).notNull().default("INR"),
  sourceFeed:       varchar("source_feed", { length: 32 }).notNull().default("manual"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
});

export const schema = { payrollPf, payrollEsi, payrollTds, payrollGratuity, payrollGpf, payrollNps, payrollTdsChallan, payrollTdsNonSalary };
