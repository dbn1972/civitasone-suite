import {
  pgSchema, uuid, varchar, bigint, date, text, timestamp, integer,
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
  parentDepartmentId:     uuid("parent_department_id").notNull(),
  parentManagerId:        uuid("parent_manager_id"),

  // Borrowing (host) assignment applied for the tenure.
  borrowingDepartment:    varchar("borrowing_department", { length: 160 }).notNull(),
  borrowingDepartmentId:  uuid("borrowing_department_id"),
  borrowingManagerId:     uuid("borrowing_manager_id"),

  // Deputation (duty) allowance — paise/month (bigint money).
  deputationAllowanceMinor: bigint("deputation_allowance_minor", { mode: "bigint" }).notNull().default(0n),

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
