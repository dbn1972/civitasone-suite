import {
  pgSchema, uuid, integer, bigint, char, varchar, numeric, timestamp,
} from "drizzle-orm/pg-core";

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

export const schema = { payrollPf, payrollEsi, payrollTds, payrollGratuity, payrollGpf, payrollNps };
