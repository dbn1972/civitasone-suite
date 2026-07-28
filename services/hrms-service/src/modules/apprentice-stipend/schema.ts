import {
  pgSchema, uuid, varchar, bigint, integer, date, text, timestamp,
} from "drizzle-orm/pg-core";

export const apprenticeshipSchema = pgSchema("apprenticeship");

/** Apprenticeship training engagement (Apprentices Act / NAPS). */
export const hrmsApprenticeships = apprenticeshipSchema.table("hrms_apprenticeships", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  tenantId:             uuid("tenant_id").notNull(),
  apprenticeId:         uuid("apprentice_id").notNull(),
  napsId:               varchar("naps_id", { length: 24 }),
  trade:                varchar("trade", { length: 120 }),
  qualification:        varchar("qualification", { length: 24 }).notNull().default("other"),
  monthlyStipendMinor:  bigint("monthly_stipend_minor", { mode: "bigint" }).notNull(),
  napsReimbPctBps:      integer("naps_reimb_pct_bps").notNull().default(2500),
  napsReimbCapMinor:    bigint("naps_reimb_cap_minor", { mode: "bigint" }).notNull().default(150000n),
  trainingStart:        date("training_start").notNull(),
  trainingEnd:          date("training_end"),
  status:               varchar("status", { length: 16 }).notNull().default("active"),
  version:              integer("version").notNull().default(1),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:            uuid("created_by").notNull(),
  updatedBy:            uuid("updated_by").notNull(),
});

/** Monthly apprentice stipend run (attendance pro-rated + NAPS reimbursement). */
export const hrmsApprenticeStipends = apprenticeshipSchema.table("hrms_apprentice_stipends", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  tenantId:             uuid("tenant_id").notNull(),
  apprenticeshipId:     uuid("apprenticeship_id").notNull(),
  month:                varchar("month", { length: 7 }).notNull(),
  workingDays:          integer("working_days").notNull(),
  daysPresent:          integer("days_present").notNull(),
  monthlyStipendMinor:  bigint("monthly_stipend_minor", { mode: "bigint" }).notNull(),
  napsReimbPctBps:      integer("naps_reimb_pct_bps").notNull().default(2500),
  napsReimbCapMinor:    bigint("naps_reimb_cap_minor", { mode: "bigint" }).notNull().default(150000n),
  grossStipendMinor:    bigint("gross_stipend_minor", { mode: "bigint" }).notNull().default(0n),
  napsReimbMinor:       bigint("naps_reimb_minor", { mode: "bigint" }).notNull().default(0n),
  employerCostMinor:    bigint("employer_cost_minor", { mode: "bigint" }).notNull().default(0n),
  status:               varchar("status", { length: 16 }).notNull().default("submitted"),
  remarks:              text("remarks"),
  approverRemarks:      text("approver_remarks"),
  paymentRef:           varchar("payment_ref", { length: 64 }),
  submittedAt:          timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  verifiedBy:           uuid("verified_by"),
  verifiedAt:           timestamp("verified_at", { withTimezone: true }),
  approvedBy:           uuid("approved_by"),
  approvedAt:           timestamp("approved_at", { withTimezone: true }),
  paidAt:               timestamp("paid_at", { withTimezone: true }),
  version:              integer("version").notNull().default(1),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:            uuid("created_by").notNull(),
  updatedBy:            uuid("updated_by").notNull(),
});

export type ApprenticeshipRow = typeof hrmsApprenticeships.$inferSelect;
export type ApprenticeshipInsert = typeof hrmsApprenticeships.$inferInsert;
export type StipendRow = typeof hrmsApprenticeStipends.$inferSelect;
export type StipendInsert = typeof hrmsApprenticeStipends.$inferInsert;

export const schema = { hrmsApprenticeships, hrmsApprenticeStipends };
