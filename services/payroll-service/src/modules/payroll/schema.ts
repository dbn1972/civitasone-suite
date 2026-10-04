import {
  pgSchema, uuid, text, integer, bigint, char, varchar, boolean, numeric, jsonb, timestamp, date,
} from "drizzle-orm/pg-core";
import { encryptedText } from "../../shared/pii-crypto.js";

export const payrollSchema = pgSchema("payroll");

export const payrollStructures = payrollSchema.table("payroll_structures", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  name:        text("name").notNull(),
  description: text("description"),
  isDefault:   boolean("is_default").notNull().default(false),
  status:      varchar("status", { length: 24 }).notNull().default("active"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const payrollComponents = payrollSchema.table("payroll_components", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  structureId:   uuid("structure_id").notNull(),
  code:          text("code").notNull(),
  name:          text("name").notNull(),
  componentType: varchar("component_type", { length: 24 }).notNull().default("earning"),
  isTaxable:     boolean("is_taxable").notNull().default(false),
  formula:       text("formula"),
  pctOfBasic:    numeric("pct_of_basic", { precision: 5, scale: 2 }),
  fixedMinor:    bigint("fixed_minor", { mode: "bigint" }),
  currency:      char("currency", { length: 3 }).notNull().default("INR"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export const payrollRuns = payrollSchema.table("payroll_runs", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  runNo:           text("run_no").notNull(),
  month:           char("month", { length: 7 }).notNull(),
  departmentId:    uuid("department_id"),
  structureId:     uuid("structure_id").notNull(),
  runType:         varchar("run_type", { length: 16 }).notNull().default("regular"),
  ddoCode:         varchar("ddo_code", { length: 32 }),
  // GAP-PAYROLL-PAY-GROUPS-03 (migration 0083): NULL = legacy whole-tenant / DDO run.
  payGroupId:      uuid("pay_group_id"),
  legalEntityId:   uuid("legal_entity_id"),          // cross-service ref to finance org.legal_entities
  totalGrossMinor: bigint("total_gross_minor", { mode: "bigint" }).notNull().default(0n),
  totalNetMinor:   bigint("total_net_minor", { mode: "bigint" }).notNull().default(0n),
  currency:        char("currency", { length: 3 }).notNull().default("INR"),
  status:          varchar("status", { length: 24 }).notNull().default("draft"),
  // payroll-critical fix: why a run ended up status='failed' (migration
  // 0046). NULL for every other status and for any run that failed before
  // this column existed -- "no recorded reason", not "definitely healthy".
  lastError:       text("last_error"),
  approvedBy:      uuid("approved_by"),
  approvedAt:      timestamp("approved_at", { withTimezone: true }),
  disbursedAt:     timestamp("disbursed_at", { withTimezone: true }),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export const payrollSlips = payrollSchema.table("payroll_slips", {
  id:                    uuid("id").primaryKey().defaultRandom(),
  tenantId:              uuid("tenant_id").notNull(),
  runId:                 uuid("run_id").notNull(),
  employeeId:            uuid("employee_id").notNull(),
  employeeNo:            text("employee_no").notNull(),
  basicMinor:            bigint("basic_minor", { mode: "bigint" }).notNull().default(0n),
  grossMinor:            bigint("gross_minor", { mode: "bigint" }).notNull().default(0n),
  totalDeductionsMinor:  bigint("total_deductions_minor", { mode: "bigint" }).notNull().default(0n),
  netPayMinor:           bigint("net_pay_minor", { mode: "bigint" }).notNull().default(0n),
  currency:              char("currency", { length: 3 }).notNull().default("INR"),
  components:            jsonb("components").$type<Array<{ code: string; name: string; type: string; amountMinor: number }>>().notNull().default([]),
  pfEmployeeMinor:       bigint("pf_employee_minor", { mode: "bigint" }).notNull().default(0n),
  pfEmployerMinor:       bigint("pf_employer_minor", { mode: "bigint" }).notNull().default(0n),
  gpfMinor:              bigint("gpf_minor", { mode: "bigint" }).notNull().default(0n),
  npsEmployeeMinor:      bigint("nps_employee_minor", { mode: "bigint" }).notNull().default(0n),
  npsEmployerMinor:      bigint("nps_employer_minor", { mode: "bigint" }).notNull().default(0n),
  esiMinor:              bigint("esi_minor", { mode: "bigint" }).notNull().default(0n),
  tdsMinor:              bigint("tds_minor", { mode: "bigint" }).notNull().default(0n),
  status:                varchar("status", { length: 24 }).notNull().default("computed"),
  // PAY-PROFILES (migration 0055): computation profile + its inputs + EPF
  // wage. NULL on slips computed before PAY-PROFILES (== govt_scale).
  payProfile:            varchar("pay_profile", { length: 32 }),
  profileSnapshot:       jsonb("profile_snapshot").$type<Record<string, unknown>>(),
  pfWageMinor:           bigint("pf_wage_minor", { mode: "bigint" }),
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:             uuid("created_by").notNull(),
  updatedBy:             uuid("updated_by").notNull(),
  version:               integer("version").notNull().default(1),
});

/** DDO (Drawing & Disbursing Officer) registry — a run is scoped to one DDO. */
export const payrollDdos = payrollSchema.table("payroll_ddos", {
  tenantId:  uuid("tenant_id").notNull(),
  ddoCode:   varchar("ddo_code", { length: 32 }).notNull(),
  name:      text("name").notNull(),
  // GAP-PAYROLL-DDOS-03 (migration 0067): a deactivated DDO cannot start new runs.
  isActive:      boolean("is_active").notNull().default(true),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  deactivatedBy: uuid("deactivated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Department -> DDO mapping; resolves each employee's department to one DDO. */
export const payrollDdoDepartments = payrollSchema.table("payroll_ddo_departments", {
  tenantId:     uuid("tenant_id").notNull(),
  departmentId: uuid("department_id").notNull(),
  ddoCode:      varchar("ddo_code", { length: 32 }).notNull(),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Pensioner master — monthly pension computation inputs. Money is PAISE bigint. */
export const payrollPensioners = payrollSchema.table("payroll_pensioners", {
  id:                    uuid("id").primaryKey().defaultRandom(),
  tenantId:              uuid("tenant_id").notNull(),
  ppoNo:                 text("ppo_no").notNull(),
  fullName:              text("full_name").notNull(),
  dateOfBirth:           date("date_of_birth").notNull(),
  basicPensionMinor:     bigint("basic_pension_minor", { mode: "bigint" }).notNull(),
  commutedPensionMinor:  bigint("commuted_pension_minor", { mode: "bigint" }).notNull().default(0n),
  commutationDate:       date("commutation_date"),
  medicalAllowanceMinor: bigint("medical_allowance_minor", { mode: "bigint" }).notNull().default(0n),
  ddoCode:               varchar("ddo_code", { length: 32 }),
  bankAccountNo:         encryptedText("bank_account_no"),
  bankIfsc:              encryptedText("bank_ifsc"),
  pan:                   encryptedText("pan"),
  taxRegime:             varchar("tax_regime", { length: 8 }).notNull().default("new"),
  // active | stopped | deceased (migration 0067, payroll_pensioners_status_check)
  status:                varchar("status", { length: 16 }).notNull().default("active"),
  statusReason:          text("status_reason"),
  statusChangedAt:       timestamp("status_changed_at", { withTimezone: true }),
  statusChangedBy:       uuid("status_changed_by"),
  dateOfDeath:           date("date_of_death"),
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:             uuid("created_by").notNull(),
  updatedBy:             uuid("updated_by").notNull(),
});

export type PayrollRunRow = typeof payrollRuns.$inferSelect;
export type PayrollRunInsert = typeof payrollRuns.$inferInsert;
export type PayrollSlipRow = typeof payrollSlips.$inferSelect;
export type PayrollPensionerRow = typeof payrollPensioners.$inferSelect;

export const schema = {
  payrollStructures, payrollComponents, payrollRuns, payrollSlips,
  payrollDdos, payrollDdoDepartments, payrollPensioners,
};
