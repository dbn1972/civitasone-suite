import {
  pgSchema, uuid, integer, bigint, char, varchar, date, timestamp, jsonb,
} from "drizzle-orm/pg-core";

const payrollSchema = pgSchema("payroll");

export const fnfSettlements = payrollSchema.table("fnf_settlements", {
  id:                         uuid("id").primaryKey().defaultRandom(),
  tenantId:                   uuid("tenant_id").notNull(),
  employeeId:                 uuid("employee_id").notNull(),
  runId:                      uuid("run_id"),
  separationType:             varchar("separation_type", { length: 24 }).notNull(),
  separationDate:             date("separation_date").notNull(),
  employeeCategory:           varchar("employee_category", { length: 24 }).notNull().default("non_govt_covered"),
  // Gross amounts (paise)
  noticeBuyoutMinor:          bigint("notice_buyout_minor", { mode: "bigint" }).notNull().default(0n),
  leaveEncashmentGrossMinor:  bigint("leave_encashment_gross_minor", { mode: "bigint" }).notNull().default(0n),
  gratuityGrossMinor:         bigint("gratuity_gross_minor", { mode: "bigint" }).notNull().default(0n),
  retrenchmentCompMinor:      bigint("retrenchment_comp_minor", { mode: "bigint" }).notNull().default(0n),
  vrsCompMinor:               bigint("vrs_comp_minor", { mode: "bigint" }).notNull().default(0n),
  arrearsMinor:               bigint("arrears_minor", { mode: "bigint" }).notNull().default(0n),
  // Exemptions
  gratuityExemptMinor:        bigint("gratuity_exempt_minor", { mode: "bigint" }).notNull().default(0n),
  leaveEncashExemptMinor:     bigint("leave_encash_exempt_minor", { mode: "bigint" }).notNull().default(0n),
  retrenchmentExemptMinor:    bigint("retrenchment_exempt_minor", { mode: "bigint" }).notNull().default(0n),
  vrsExemptMinor:             bigint("vrs_exempt_minor", { mode: "bigint" }).notNull().default(0n),
  // Tax
  totalTaxableMinor:          bigint("total_taxable_minor", { mode: "bigint" }).notNull().default(0n),
  tdsOnSeparationMinor:       bigint("tds_on_separation_minor", { mode: "bigint" }).notNull().default(0n),
  netPayableMinor:            bigint("net_payable_minor", { mode: "bigint" }).notNull().default(0n),
  // Metadata
  computationDetail:          jsonb("computation_detail"),
  status:                     varchar("status", { length: 16 }).notNull().default("draft"),
  currency:                   char("currency", { length: 3 }).notNull().default("INR"),
  createdAt:                  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:                  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:                  uuid("created_by").notNull(),
  updatedBy:                  uuid("updated_by").notNull(),
  version:                    integer("version").notNull().default(1),
});

export const ltcExemptions = payrollSchema.table("ltc_exemptions", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  tenantId:           uuid("tenant_id").notNull(),
  employeeId:         uuid("employee_id").notNull(),
  fy:                 char("fy", { length: 7 }).notNull(),
  claimId:            uuid("claim_id").notNull(),
  blockYear:          varchar("block_year", { length: 16 }).notNull(),
  ltcType:            varchar("ltc_type", { length: 16 }).notNull(),
  approvedFareMinor:  bigint("approved_fare_minor", { mode: "bigint" }).notNull(),
  exemptAmountMinor:  bigint("exempt_amount_minor", { mode: "bigint" }).notNull(),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const exemptionCeilings = payrollSchema.table("exemption_ceilings", {
  id:           uuid("id").primaryKey().defaultRandom(),
  fyStartYear:  integer("fy_start_year").notNull(),
  section:      varchar("section", { length: 16 }).notNull(),
  ceilingMinor: bigint("ceiling_minor", { mode: "bigint" }).notNull(),
  notes:        varchar("notes", { length: 512 }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FnfSettlementRow = typeof fnfSettlements.$inferSelect;
export type FnfSettlementInsert = typeof fnfSettlements.$inferInsert;
export type LtcExemptionRow = typeof ltcExemptions.$inferSelect;
export type LtcExemptionInsert = typeof ltcExemptions.$inferInsert;
export type ExemptionCeilingRow = typeof exemptionCeilings.$inferSelect;
