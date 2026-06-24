import {
  pgSchema, uuid, bigint, char, varchar, timestamp,
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

export const schema = { taxDeclarations };
