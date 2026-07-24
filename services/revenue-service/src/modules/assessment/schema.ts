/**
 * Assessment + Demand + DCB Ledger schema.
 *
 * PG schema: `assessment`
 * _Requirements: SVC-131_
 */
import {
  pgSchema, uuid, text, integer, varchar, timestamp, date, bigint, boolean, jsonb,
} from "drizzle-orm/pg-core";

export const assessmentSchema = pgSchema("assessment");

// ── assessment.assessments ────────────────────────────────────────────────────
export const assessments = assessmentSchema.table("assessments", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  assesseeId:     uuid("assessee_id").notNull(),
  rateHeadId:     uuid("rate_head_id").notNull(),
  financialYear:  varchar("financial_year", { length: 9 }).notNull(), // 2024-2025
  baseValue:      bigint("base_value", { mode: "bigint" }).notNull(), // paise
  exemptions:     jsonb("exemptions").notNull().default([]),
  status:         varchar("status", { length: 24 }).notNull().default("active"), // active, revised, closed
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

// ── assessment.demands ────────────────────────────────────────────────────────
export const demands = assessmentSchema.table("demands", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  assesseeId:     uuid("assessee_id").notNull(),
  assessmentId:   uuid("assessment_id").notNull(),
  rateHeadId:     uuid("rate_head_id").notNull(),
  financialYear:  varchar("financial_year", { length: 9 }).notNull(),
  dueDate:        date("due_date").notNull(),
  principalMinor: bigint("principal_minor", { mode: "bigint" }).notNull(),
  rebateMinor:    bigint("rebate_minor", { mode: "bigint" }).notNull().default(0n),
  penaltyMinor:   bigint("penalty_minor", { mode: "bigint" }).notNull().default(0n),
  interestMinor:  bigint("interest_minor", { mode: "bigint" }).notNull().default(0n),
  netMinor:       bigint("net_minor", { mode: "bigint" }).notNull(),
  /** Engine compute snapshot for re-derivation */
  computeSnapshot: jsonb("compute_snapshot").notNull(),
  status:         varchar("status", { length: 24 }).notNull().default("raised"), // raised, partially_paid, paid, written_off
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

// ── assessment.dcb_entries (Demand-Collection-Balance ledger) ──────────────────
export const dcbEntries = assessmentSchema.table("dcb_entries", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  assesseeId:     uuid("assessee_id").notNull(),
  demandId:       uuid("demand_id").notNull(),
  entryType:      varchar("entry_type", { length: 16 }).notNull(), // demand, collection, refund, adjustment, write_off
  amountMinor:    bigint("amount_minor", { mode: "bigint" }).notNull(), // positive for demand, negative for collection
  balanceMinor:   bigint("balance_minor", { mode: "bigint" }).notNull(), // running balance after this entry
  referenceId:    uuid("reference_id"), // receipt/refund/adjustment/writeoff ID
  referenceType:  varchar("reference_type", { length: 24 }), // receipt, refund, adjustment, write_off
  narration:      text("narration"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
});

// ── assessment.remissions ─────────────────────────────────────────────────────
export const remissions = assessmentSchema.table("remissions", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  assessmentId:   uuid("assessment_id").notNull(),
  reason:         text("reason").notNull(),
  remissionPercent: integer("remission_percent"),
  amountMinor:    bigint("amount_minor", { mode: "bigint" }),
  status:         varchar("status", { length: 16 }).notNull().default("pending"), // pending, approved, rejected
  makerUserId:    uuid("maker_user_id").notNull(),
  checkerUserId:  uuid("checker_user_id"),
  decidedAt:      timestamp("decided_at", { withTimezone: true }),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version:        integer("version").notNull().default(1),
});

// ── Inferred types ────────────────────────────────────────────────────────────
export type AssessmentRow = typeof assessments.$inferSelect;
export type AssessmentInsert = typeof assessments.$inferInsert;
export type DemandRow = typeof demands.$inferSelect;
export type DemandInsert = typeof demands.$inferInsert;
export type DcbEntryRow = typeof dcbEntries.$inferSelect;
export type DcbEntryInsert = typeof dcbEntries.$inferInsert;
export type RemissionRow = typeof remissions.$inferSelect;
export type RemissionInsert = typeof remissions.$inferInsert;

export const schema = { assessments, demands, dcbEntries, remissions };
