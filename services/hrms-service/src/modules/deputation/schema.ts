import {
  pgSchema, uuid, varchar, bigint, date, text, timestamp, integer, smallint, boolean,
} from "drizzle-orm/pg-core";

// Deputation lives under the lifecycle schema (alongside service-book entries).
export const deputationSchema = pgSchema("lifecycle");

/**
 * Deputation lifecycle: an employee is deputed OUT from their parent cadre to a
 * borrowing department for a fixed tenure, drawing a deputation (duty)
 * allowance, then REPATRIATED back. While on deputation the employee's
 * effective reporting (managerId) and posting (departmentId) are switched to the
 * borrowing assignment; the parent values are snapshotted here so repatriation
 * can restore them exactly.
 */
export const hrmsDeputations = deputationSchema.table("hrms_deputations", {
  id:                     uuid("id").primaryKey().defaultRandom(),
  tenantId:               uuid("tenant_id").notNull(),
  employeeId:             uuid("employee_id").notNull(),

  // Parent cadre snapshot (restored on repatriation).
  parentCadre:            varchar("parent_cadre", { length: 120 }).notNull(),
  // Nullable since migration 0167: a deputed-IN employee's parent is an
  // external organisation (DB CHECK: required when direction = 'out').
  parentDepartmentId:     uuid("parent_department_id"),
  parentManagerId:        uuid("parent_manager_id"),

  // Borrowing (host) assignment applied for the tenure.
  borrowingDepartment:    varchar("borrowing_department", { length: 160 }).notNull(),
  borrowingDepartmentId:  uuid("borrowing_department_id"),
  borrowingManagerId:     uuid("borrowing_manager_id"),

  // Deputation (duty) allowance — paise/month (bigint money).
  deputationAllowanceMinor: bigint("deputation_allowance_minor", { mode: "bigint" }).notNull().default(0n),

  // Pay terms of the deputation order (migration 0167, PAY-PROFILES). Only
  // read by payroll once an APPROVED pay profile points at this row.
  direction:              varchar("direction", { length: 4 }).notNull().default("out"), // out | in
  payOption:              varchar("pay_option", { length: 16 }),        // parent_scale (Option A) | post_scale (Option B)
  stationType:            varchar("station_type", { length: 8 }),       // same | other
  parentOrganisation:     varchar("parent_organisation", { length: 200 }),
  parentPayLevel:         smallint("parent_pay_level"),
  parentBasicMinor:       bigint("parent_basic_minor", { mode: "bigint" }),
  postPayLevel:           smallint("post_pay_level"),
  postBasicMinor:         bigint("post_basic_minor", { mode: "bigint" }),
  // auto = tenant rule (% of basic, capped) once configured in payroll, else
  // deputationAllowanceMinor; fixed = per-employee override from the order.
  allowanceMode:          varchar("allowance_mode", { length: 8 }).notNull().default("auto"),
  foreignService:         boolean("foreign_service").notNull().default(false),
  parentPensionScheme:    varchar("parent_pension_scheme", { length: 8 }), // GPF | NPS | EPF
  daSource:               varchar("da_source", { length: 8 }).notNull().default("central"), // central | parent
  parentDaRateBps:        integer("parent_da_rate_bps"),

  // Tenure.
  tenureFrom:             date("tenure_from").notNull(),
  tenureTo:               date("tenure_to").notNull(),

  // Lifecycle.
  status:                 varchar("status", { length: 16 }).notNull().default("active"), // active | repatriated | cancelled
  repatriatedOn:          date("repatriated_on"),
  repatriationNote:       text("repatriation_note"),
  orderRef:               varchar("order_ref", { length: 120 }),
  remarks:                text("remarks"),

  createdAt:              timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:              timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:              uuid("created_by").notNull(),
  updatedBy:             uuid("updated_by").notNull(),
  version:                integer("version").notNull().default(1),
});

export type DeputationRow = typeof hrmsDeputations.$inferSelect;
export type DeputationInsert = typeof hrmsDeputations.$inferInsert;

export const schema = { hrmsDeputations };
