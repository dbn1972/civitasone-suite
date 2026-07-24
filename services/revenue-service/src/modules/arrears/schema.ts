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
  status:         varchar("status", { length: 16 }).notNull().default("active"), // active, completed, defaulted
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
  status:         varchar("status", { length: 16 }).notNull().default("referred"), // referred, accepted, resolved
  referredAt:     timestamp("referred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type InstalmentPlanRow = typeof instalmentPlans.$inferSelect;
export type InstalmentPlanInsert = typeof instalmentPlans.$inferInsert;
export type InstalmentRow = typeof instalments.$inferSelect;
export type InstalmentInsert = typeof instalments.$inferInsert;
export type WriteOffRow = typeof writeOffs.$inferSelect;
export type WriteOffInsert = typeof writeOffs.$inferInsert;
export type RecoveryReferralRow = typeof recoveryReferrals.$inferSelect;
export type RecoveryReferralInsert = typeof recoveryReferrals.$inferInsert;

export const schema = { instalmentPlans, instalments, writeOffs, recoveryReferrals };
