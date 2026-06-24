import {
  pgSchema, uuid, char, varchar, date, integer, bigint, numeric, jsonb, timestamp,
} from "drizzle-orm/pg-core";

export const pensionSchema = pgSchema("pension");

export const hrmsPensionRecords = pensionSchema.table("hrms_pension_records", {
  id:                       uuid("id").primaryKey().defaultRandom(),
  tenantId:                 uuid("tenant_id").notNull(),
  employeeId:               uuid("employee_id").notNull(),
  pensionScheme:            varchar("pension_scheme", { length: 8 }).notNull(),
  retirementDate:           date("retirement_date").notNull(),
  dateOfJoining:            date("date_of_joining").notNull(),
  lastBasicMinor:           bigint("last_basic_minor", { mode: "bigint" }).notNull().default(0n),
  daRatePct:                numeric("da_rate_pct").notNull().default("0"),
  avgEmolumentsMinor:       bigint("avg_emoluments_minor", { mode: "bigint" }).notNull().default(0n),
  qualifyingHalfYears:      integer("qualifying_half_years").notNull().default(0),
  qualifyingYears:          numeric("qualifying_years").notNull().default("0"),
  monthlyPensionMinor:      bigint("monthly_pension_minor", { mode: "bigint" }).notNull().default(0n),
  commutedPct:              numeric("commuted_pct").notNull().default("0"),
  commutedValueMinor:       bigint("commuted_value_minor", { mode: "bigint" }).notNull().default(0n),
  residualPensionMinor:     bigint("residual_pension_minor", { mode: "bigint" }).notNull().default(0n),
  dcrgMinor:                bigint("dcrg_minor", { mode: "bigint" }).notNull().default(0n),
  familyPensionNormalMinor: bigint("family_pension_normal_minor", { mode: "bigint" }).notNull().default(0n),
  familyPensionEnhancedMinor: bigint("family_pension_enhanced_minor", { mode: "bigint" }).notNull().default(0n),
  breakdown:                jsonb("breakdown").notNull().default({}),
  currency:                 char("currency", { length: 3 }).notNull().default("INR"),
  createdAt:                timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:                timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:                uuid("created_by").notNull(),
  updatedBy:                uuid("updated_by").notNull(),
  version:                  integer("version").notNull().default(1),
});

export type PensionRecordRow = typeof hrmsPensionRecords.$inferSelect;
