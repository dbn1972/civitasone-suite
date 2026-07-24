/**
 * quarters module — Residential quarters allotment, licence-fee,
 * vacation/handover for government establishments (SVC-058).
 *
 * Tables:
 *   estab_quarters       — inventory of quarters (type, category, address)
 *   estab_quarter_allotments — waitlist→allot→occupy→vacate workflow
 *   estab_licence_fee_rates — effective-dated monthly licence-fee schedule
 *   estab_overstay_penalties — penalty records for overstay beyond vacation date
 *
 * PG Schema: `quarters`
 * All money as bigint paise. Optimistic locking via `version`.
 */
import {
  pgSchema, uuid, text, varchar, integer, bigint, char, boolean, date, timestamp, numeric,
} from "drizzle-orm/pg-core";

export const quartersSchema = pgSchema("quarters");

/** Quarter inventory — individual units available for allotment. */
export const estabQuarters = quartersSchema.table("estab_quarters", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  quarterNo:    text("quarter_no").notNull(),
  quarterType:  varchar("quarter_type", { length: 16 }).notNull().default("type_iv"),
  category:     varchar("category", { length: 32 }).notNull().default("general"),
  address:      text("address"),
  locality:     text("locality"),
  carpetAreaSqft: integer("carpet_area_sqft"),
  status:       varchar("status", { length: 24 }).notNull().default("vacant"),
  condition:    varchar("condition", { length: 24 }).notNull().default("good"),
  orgUnit:      varchar("org_unit", { length: 64 }),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

/**
 * Allotment workflow:
 *   applied → waitlisted → allotted → occupied → vacation_notice → vacated → cancelled
 * Maker-checker: allottedBy ≠ applicant (enforced in domain).
 */
export const estabQuarterAllotments = quartersSchema.table("estab_quarter_allotments", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  quarterId:        uuid("quarter_id").notNull(),
  employeeRef:      uuid("employee_ref").notNull(),
  designation:      varchar("designation", { length: 120 }),
  payLevel:         varchar("pay_level", { length: 16 }),
  eligibilityScore: integer("eligibility_score").notNull().default(0),
  appliedAt:        timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  waitlistPosition: integer("waitlist_position"),
  status:           varchar("status", { length: 24 }).notNull().default("applied"),
  allottedAt:       timestamp("allotted_at", { withTimezone: true }),
  allottedBy:       uuid("allotted_by"),
  occupiedAt:       timestamp("occupied_at", { withTimezone: true }),
  vacationNoticeAt: timestamp("vacation_notice_at", { withTimezone: true }),
  vacationDueDate:  date("vacation_due_date"),
  vacatedAt:        timestamp("vacated_at", { withTimezone: true }),
  handoverNotes:    text("handover_notes"),
  cancelledAt:      timestamp("cancelled_at", { withTimezone: true }),
  cancelReason:     text("cancel_reason"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

/**
 * Licence-fee rate schedule — effective-dated monthly charges per quarter type.
 * No hardcoded amounts; rates are configurable per tenant + quarter_type + pay_level.
 * Used by payroll deduction and finance receivable generation.
 */
export const estabLicenceFeeRates = quartersSchema.table("estab_licence_fee_rates", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  quarterType:   varchar("quarter_type", { length: 16 }).notNull(),
  payLevel:      varchar("pay_level", { length: 16 }).notNull(),
  monthlyMinor:  bigint("monthly_minor", { mode: "bigint" }).notNull(),
  currency:      char("currency", { length: 3 }).notNull().default("INR"),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo:   date("effective_to"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  version:       integer("version").notNull().default(1),
});

/**
 * Overstay penalties — auto-generated when an occupant stays past vacation_due_date.
 * Penalty = configurable multiplier × daily licence-fee rate.
 */
export const estabOverstayPenalties = quartersSchema.table("estab_overstay_penalties", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  allotmentId:   uuid("allotment_id").notNull(),
  employeeRef:   uuid("employee_ref").notNull(),
  penaltyDays:   integer("penalty_days").notNull(),
  dailyRateMinor: bigint("daily_rate_minor", { mode: "bigint" }).notNull(),
  multiplier:    numeric("multiplier", { precision: 4, scale: 2 }).notNull().default("2.0"),
  totalMinor:    bigint("total_minor", { mode: "bigint" }).notNull(),
  currency:      char("currency", { length: 3 }).notNull().default("INR"),
  status:        varchar("status", { length: 24 }).notNull().default("pending"),
  recoveredAt:   timestamp("recovered_at", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export type QuarterRow       = typeof estabQuarters.$inferSelect;
export type QuarterInsert    = typeof estabQuarters.$inferInsert;
export type AllotmentRow     = typeof estabQuarterAllotments.$inferSelect;
export type AllotmentInsert  = typeof estabQuarterAllotments.$inferInsert;
export type LicenceFeeRateRow    = typeof estabLicenceFeeRates.$inferSelect;
export type LicenceFeeRateInsert = typeof estabLicenceFeeRates.$inferInsert;
export type OverstayPenaltyRow   = typeof estabOverstayPenalties.$inferSelect;
export type OverstayPenaltyInsert = typeof estabOverstayPenalties.$inferInsert;

export const schema = { estabQuarters, estabQuarterAllotments, estabLicenceFeeRates, estabOverstayPenalties };
