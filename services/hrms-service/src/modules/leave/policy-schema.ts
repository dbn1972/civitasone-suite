import { pgSchema, uuid, varchar, integer, boolean, timestamp } from "drizzle-orm/pg-core";

const leaveSchema = pgSchema("leave");

export const hrmsLeavePolicyRules = leaveSchema.table("hrms_leave_policy_rules", {
  id:                          uuid("id").primaryKey().defaultRandom(),
  tenantId:                    uuid("tenant_id").notNull(),
  leaveTypeId:                 uuid("leave_type_id").notNull(),
  employeeType:                varchar("employee_type", { length: 32 }).notNull(),
  maxDaysPerYear:              integer("max_days_per_year").notNull().default(0),
  carryForward:                boolean("carry_forward").notNull().default(false),
  maxAccumulation:             integer("max_accumulation").notNull().default(0),
  encashable:                  boolean("encashable").notNull().default(false),
  countMethod:                 varchar("count_method", { length: 16 }).notNull().default("calendar"),
  maxContinuousDays:           integer("max_continuous_days").notNull().default(365),
  minServiceMonths:            integer("min_service_months").notNull().default(0),
  genderRestriction:           varchar("gender_restriction", { length: 8 }),
  requiresMedicalCert:         boolean("requires_medical_cert").notNull().default(false),
  requiresMedicalCertAfterDays: integer("requires_medical_cert_after_days").notNull().default(3),
  prefixSuffixRule:            boolean("prefix_suffix_rule").notNull().default(false),
  sandwichRule:                boolean("sandwich_rule").notNull().default(false),
  proRataOnJoining:            boolean("pro_rata_on_joining").notNull().default(true),
  isActive:                    boolean("is_active").notNull().default(true),
  createdAt:                   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:                   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:                   uuid("created_by").notNull(),
  updatedBy:                   uuid("updated_by").notNull(),
  version:                     integer("version").notNull().default(1),
});

export type LeavePolicyRuleRow = typeof hrmsLeavePolicyRules.$inferSelect;
