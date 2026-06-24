import {
  pgSchema, uuid, integer, bigint, char, varchar, timestamp, jsonb,
} from "drizzle-orm/pg-core";

export const payrollSchema = pgSchema("payroll");

export const taxDeclarations = payrollSchema.table("payroll_tax_declarations", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  employeeId:      uuid("employee_id").notNull(),
  fy:              char("fy", { length: 7 }).notNull(),
  regime:          varchar("regime", { length: 4 }).notNull().default("new"),
  section80c:      bigint("section_80c", { mode: "bigint" }).notNull().default(0n),
  section80d:      bigint("section_80d", { mode: "bigint" }).notNull().default(0n),
  hraClaimed:      bigint("hra_claimed", { mode: "bigint" }).notNull().default(0n),
  rentPaidMinor:   bigint("rent_paid_minor", { mode: "bigint" }).notNull().default(0n),
  otherDeductions: bigint("other_deductions", { mode: "bigint" }).notNull().default(0n),
  prevEmployerSalaryMinor: bigint("prev_employer_salary_minor", { mode: "bigint" }).notNull().default(0n),
  prevEmployerTdsMinor:    bigint("prev_employer_tds_minor", { mode: "bigint" }).notNull().default(0n),
  otherSourcesIncomeMinor: bigint("other_sources_income_minor", { mode: "bigint" }).notNull().default(0n),
  perquisitesMinor:        bigint("perquisites_minor", { mode: "bigint" }).notNull().default(0n),
  status:          varchar("status", { length: 16 }).notNull().default("draft"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
});

export type TaxDeclarationRow = typeof taxDeclarations.$inferSelect;
export type TaxDeclarationInsert = typeof taxDeclarations.$inferInsert;


export const taxSlabConfig = payrollSchema.table("tax_slab_config", {
  id:              uuid("id").primaryKey().defaultRandom(),
  fyStartYear:     integer("fy_start_year").notNull(),
  regime:          varchar("regime", { length: 4 }).notNull(),
  slabs:           jsonb("slabs").notNull(),
  stdDeduction:    bigint("std_deduction", { mode: "bigint" }).notNull().default(0n),
  rebateIncomeCap: bigint("rebate_income_cap", { mode: "bigint" }).notNull().default(0n),
  rebateMax:       bigint("rebate_max", { mode: "bigint" }).notNull().default(0n),
  surchargeBands:  jsonb("surcharge_bands").notNull(),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const perquisiteComponents = payrollSchema.table("perquisite_components", {
  id:                    uuid("id").primaryKey().defaultRandom(),
  tenantId:              uuid("tenant_id").notNull(),
  employeeId:            uuid("employee_id").notNull(),
  fy:                    char("fy", { length: 7 }).notNull(),
  nature:                varchar("nature", { length: 64 }).notNull(),
  description:           varchar("description", { length: 255 }).notNull().default(""),
  valueByEmployerMinor:  bigint("value_by_employer_minor", { mode: "bigint" }).notNull().default(0n),
  amountRecoveredMinor:  bigint("amount_recovered_minor", { mode: "bigint" }).notNull().default(0n),
  taxableValueMinor:     bigint("taxable_value_minor", { mode: "bigint" }).notNull().default(0n),
  currency:              char("currency", { length: 3 }).notNull().default("INR"),
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:             uuid("created_by").notNull(),
});

export type TaxSlabConfigRow = typeof taxSlabConfig.$inferSelect;
export type PerquisiteComponentRow = typeof perquisiteComponents.$inferSelect;

export const schema = { taxDeclarations, taxSlabConfig, perquisiteComponents };
