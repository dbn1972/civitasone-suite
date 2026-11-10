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
  // Section 8 G2 (migration 0166): run | ctc_template, lock, effective date, version lineage.
  kind:              varchar("kind", { length: 16 }).notNull().default("run"),
  isLocked:          boolean("is_locked").notNull().default(false),
  lockedAt:          timestamp("locked_at", { withTimezone: true }),
  lockedBy:          uuid("locked_by"),
  effectiveFrom:     date("effective_from", { mode: "string" }),
  templateVersion:   integer("template_version").notNull().default(1),
  parentStructureId: uuid("parent_structure_id"),
  lineageRootId:     uuid("lineage_root_id"),
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
  // Section 8 G2 (migration 0166). See pay-components/model.ts for the value sets.
  isActive:          boolean("is_active").notNull().default(true),
  calc:              varchar("calc", { length: 24 }),
  pctOfCtcBps:       integer("pct_of_ctc_bps"),
  employerCostClass: varchar("employer_cost_class", { length: 24 }),
  costPlacement:     varchar("cost_placement", { length: 16 }).notNull().default("inside_ctc"),
  countsForPfWage:   boolean("counts_for_pf_wage").notNull().default(false),
  countsForEsiWage:  boolean("counts_for_esi_wage").notNull().default(false),
  countsForGratuity: boolean("counts_for_gratuity").notNull().default(false),
  lopApplicable:     boolean("lop_applicable").notNull().default(false),
  payslipOrder:      integer("payslip_order"),
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
  components:            jsonb("components").$type<Array<{ code: string; name: string; type: string; amountMinor: number; lopDays?: number; daysInMonth?: number }>>().notNull().default([]),
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
  // S8 G1 (migration 0168): NULL on every slip that is not a ctc_contract slip.
  ctcTemplateId:         uuid("ctc_template_id"),
  ctcTemplateVersion:    integer("ctc_template_version"),
  employerEsiMinor:      bigint("employer_esi_minor", { mode: "bigint" }),
  gratuityProvisionMinor: bigint("gratuity_provision_minor", { mode: "bigint" }),
  // UAT T-PERIOD D-02b / PR #2459 review (migration 0165): the TDS signals the
  // approver must see -- presumed months, excess, capped shortfall (final: the
  // last FY / separation month, not recoverable by payroll), deferred recovery.
  tdsPresumedMonths:     integer("tds_presumed_months").notNull().default(0),
  tdsExcessMinor:        bigint("tds_excess_minor", { mode: "bigint" }).notNull().default(0n),
  tdsShortfallMinor:     bigint("tds_shortfall_minor", { mode: "bigint" }).notNull().default(0n),
  tdsShortfallFinal:     boolean("tds_shortfall_final").notNull().default(false),
  recoveryDeferredMinor: bigint("recovery_deferred_minor", { mode: "bigint" }).notNull().default(0n),
  createdAt:             timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:             uuid("created_by").notNull(),
  updatedBy:             uuid("updated_by").notNull(),
  version:               integer("version").notNull().default(1),
});

/**
 * PR #2459 review B1 (migration 0165): the opening year-to-date of an employee
 * for an FY -- salary paid and TDS deducted by this employer before go-live
 * (pre_go_live, months covered) or by a previous employer (prior_employer,
 * Form 12B). Maker-checker; only approved rows feed the s.192 projection, as
 * authoritative figures (no presumption once one exists).
 */
export const payrollOpeningYtd = payrollSchema.table("payroll_opening_ytd", {
  id:                uuid("id").primaryKey().defaultRandom(),
  tenantId:          uuid("tenant_id").notNull(),
  employeeId:        uuid("employee_id").notNull(),
  fy:                char("fy", { length: 7 }).notNull(),
  source:            varchar("source", { length: 16 }).notNull(),
  months:            integer("months").notNull().default(0),
  salaryMinor:       bigint("salary_minor", { mode: "bigint" }).notNull().default(0n),
  tdsMinor:          bigint("tds_minor", { mode: "bigint" }).notNull().default(0n),
  priorEmployerName: text("prior_employer_name"),
  priorEmployerTan:  varchar("prior_employer_tan", { length: 10 }),
  note:              text("note").notNull(),
  status:            varchar("status", { length: 16 }).notNull().default("pending"),
  /** Delta review SF2: the approved version this one corrects (superseded on approval, kept). */
  supersedesId:      uuid("supersedes_id"),
  enteredBy:         uuid("entered_by").notNull(),
  approvedBy:        uuid("approved_by"),
  decidedAt:         timestamp("decided_at", { withTimezone: true }),
  decisionNote:      text("decision_note"),
  createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:           integer("version").notNull().default(1),
});
export type OpeningYtdRow = typeof payrollOpeningYtd.$inferSelect;

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
