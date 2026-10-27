/**
 * Arrears & Recovery schema — instalment plans, write-offs, recovery referrals.
 *
 * PG schema: `arrears`
 * _Requirements: SVC-137_
 */
import {
  pgSchema, uuid, text, integer, varchar, timestamp, date, bigint,
} from "drizzle-orm/pg-core";

export const arrearsSchema = pgSchema("arrears");

// ── arrears.instalment_plans ──────────────────────────────────────────────────
export const instalmentPlans = arrearsSchema.table("instalment_plans", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  assesseeId:     uuid("assessee_id").notNull(),
  totalMinor:     bigint("total_minor", { mode: "bigint" }).notNull(),
  instalmentCount: integer("instalment_count").notNull(),
  startDate:      date("start_date").notNull(),
  // Owner decision #3: a plan defers a demand, so it is created `pending` and
  // only becomes `active` when a DIFFERENT officer approves it (or `rejected`).
  status:         varchar("status", { length: 16 }).notNull().default("pending"), // pending, active, rejected, completed, defaulted
  checkerUserId:  uuid("checker_user_id"),
  decidedAt:      timestamp("decided_at", { withTimezone: true }),
  decisionReason: text("decision_reason"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  version:        integer("version").notNull().default(1),
});

// ── arrears.instalments ───────────────────────────────────────────────────────
export const instalments = arrearsSchema.table("instalments", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  planId:         uuid("plan_id").notNull(),
  sequenceNo:     integer("sequence_no").notNull(),
  dueDate:        date("due_date").notNull(),
  amountMinor:    bigint("amount_minor", { mode: "bigint" }).notNull(),
  paidMinor:      bigint("paid_minor", { mode: "bigint" }).notNull().default(0n),
  status:         varchar("status", { length: 16 }).notNull().default("pending"), // pending, paid, overdue
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── arrears.write_offs ────────────────────────────────────────────────────────
export const writeOffs = arrearsSchema.table("write_offs", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  assesseeId:     uuid("assessee_id").notNull(),
  // GAP-REVENUE-WRITE-OFFS-03: optional reference to the specific demand (and
  // its financial year) the write-off reduces, so the audit/decide trail can
  // say which year was written off. Nullable — pre-existing rows have none.
  demandId:       uuid("demand_id"),
  financialYear:  varchar("financial_year", { length: 16 }),
  amountMinor:    bigint("amount_minor", { mode: "bigint" }).notNull(),
  reason:         text("reason").notNull(),
  status:         varchar("status", { length: 16 }).notNull().default("pending"), // pending, approved, rejected
  makerUserId:    uuid("maker_user_id").notNull(),
  checkerUserId:  uuid("checker_user_id"),
  decidedAt:      timestamp("decided_at", { withTimezone: true }),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:        integer("version").notNull().default(1),
});

// ── arrears.recovery_referrals ────────────────────────────────────────────────
export const recoveryReferrals = arrearsSchema.table("recovery_referrals", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  assesseeId:     uuid("assessee_id").notNull(),
  reason:         text("reason").notNull(),
  legalCaseId:    uuid("legal_case_id"),
  // Owner decision #4: maker-checker. `pending` until a DIFFERENT officer approves
  // (-> `referred`, legal-service is notified then) or rejects (-> `rejected`).
  status:         varchar("status", { length: 16 }).notNull().default("pending"), // pending, referred, rejected, accepted, resolved
  noticeId:       uuid("notice_id"), // the lapsed demand notice this referral relied on
  checkerUserId:  uuid("checker_user_id"),
  decidedAt:      timestamp("decided_at", { withTimezone: true }),
  decisionReason: text("decision_reason"),
  referredAt:     timestamp("referred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  version:        integer("version").notNull().default(1),
});

// ── arrears.demand_notices ────────────────────────────────────────────────────
// Owner decision #4: a served demand notice. A recovery referral may only be
// raised once a notice has been served AND its notice period has lapsed.
export const demandNotices = arrearsSchema.table("demand_notices", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  assesseeId:       uuid("assessee_id").notNull(),
  demandId:         uuid("demand_id"),
  noticeNo:         varchar("notice_no", { length: 64 }).notNull(),
  servedOn:         date("served_on").notNull(),
  noticePeriodDays: integer("notice_period_days").notNull(),
  servedBy:         uuid("served_by").notNull(),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  version:          integer("version").notNull().default(1),
});

export type InstalmentPlanRow = typeof instalmentPlans.$inferSelect;
export type InstalmentPlanInsert = typeof instalmentPlans.$inferInsert;
export type InstalmentRow = typeof instalments.$inferSelect;
export type InstalmentInsert = typeof instalments.$inferInsert;
export type WriteOffRow = typeof writeOffs.$inferSelect;
export type WriteOffInsert = typeof writeOffs.$inferInsert;
export type RecoveryReferralRow = typeof recoveryReferrals.$inferSelect;
export type RecoveryReferralInsert = typeof recoveryReferrals.$inferInsert;

export const schema = { instalmentPlans, instalments, writeOffs, recoveryReferrals, demandNotices };
