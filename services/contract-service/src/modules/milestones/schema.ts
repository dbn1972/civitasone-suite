/**
 * G15 — MoU / contract milestone governance: penalty & SLA terms, the
 * penalty-application ledger, and the periodic review schedule.
 *
 * The milestone table itself is NOT declared here. `contracts.contract_
 * milestones` already exists and is owned by the contracts module
 * (src/modules/contracts/schema.ts). This module extends that table via
 * migration 0018 and reads/writes it through the contracts module's Drizzle
 * definition rather than re-declaring it — see README.md for the decision.
 */
import { pgSchema, uuid, text, integer, bigint, char, varchar, boolean, timestamp, date, jsonb } from "drizzle-orm/pg-core";

export const mouSchema = pgSchema("mou");

/**
 * Penalty / SLA terms attached to a contract or MoU.
 *
 * Money representation, deliberately split in two columns:
 *   - `penaltyAmountMinor` (bigint minor units) for `fixed` and `per_day`
 *   - `penaltyRateBps` (integer basis points, 1 bp = 0.01%) for `percentage`
 *
 * Basis points are an exact integer, so penalty = amountMinor * BigInt(bps)
 * / 10000n is pure BigInt arithmetic. A numeric/float percentage would force
 * a Number cast on money and reintroduce binary-fraction error.
 */
export const penaltyTerms = mouSchema.table("penalty_terms", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  contractId:          uuid("contract_id").notNull(),
  termCode:            varchar("term_code", { length: 64 }).notNull(),
  description:         text("description").notNull().default(""),
  /** "milestone_missed" | "sla_breached" */
  triggerType:         varchar("trigger_type", { length: 32 }).notNull(),
  /** Grace days (milestone_missed) or breach count (sla_breached). */
  thresholdValue:      integer("threshold_value").notNull().default(0),
  /** "fixed" | "percentage" | "per_day" */
  penaltyKind:         varchar("penalty_kind", { length: 16 }).notNull(),
  penaltyAmountMinor:  bigint("penalty_amount_minor", { mode: "bigint" }),
  penaltyRateBps:      integer("penalty_rate_bps"),
  maxPenaltyBps:       integer("max_penalty_bps").notNull().default(10_000),
  currency:            char("currency", { length: 3 }).notNull().default("INR"),
  active:              boolean("active").notNull().default(true),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid("created_by").notNull(),
  updatedBy:           uuid("updated_by").notNull(),
  version:             integer("version").notNull().default(1),
});

/**
 * Append-only ledger of penalties actually applied.
 *
 * UNIQUE (tenant_id, penalty_term_id, occurrence_key) is the database-level
 * double-count guard: the same occurrence can never be charged twice, whatever
 * the application or the queue does.
 */
export const penaltyApplications = mouSchema.table("penalty_applications", {
  id:                  uuid("id").primaryKey().defaultRandom(),
  tenantId:            uuid("tenant_id").notNull(),
  contractId:          uuid("contract_id").notNull(),
  penaltyTermId:       uuid("penalty_term_id").notNull(),
  /** Null when the trigger was an SLA breach not tied to one milestone. */
  milestoneId:         uuid("milestone_id"),
  /** Deterministic occurrence identity, e.g. "milestone:<uuid>". */
  occurrenceKey:       text("occurrence_key").notNull(),
  computedAmountMinor: bigint("computed_amount_minor", { mode: "bigint" }).notNull(),
  currency:            char("currency", { length: 3 }).notNull().default("INR"),
  basis:               jsonb("basis"),
  appliedAt:           timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:           uuid("created_by").notNull(),
  updatedBy:           uuid("updated_by").notNull(),
  version:             integer("version").notNull().default(1),
});

/** Periodic MoU review schedule (§25.7 "review-date" term). */
export const reviewSchedules = mouSchema.table("review_schedules", {
  id:               uuid("id").primaryKey().defaultRandom(),
  tenantId:         uuid("tenant_id").notNull(),
  contractId:       uuid("contract_id").notNull(),
  reviewCode:       varchar("review_code", { length: 64 }).notNull(),
  /** "monthly" | "quarterly" | "half_yearly" | "annual" */
  cadence:          varchar("cadence", { length: 16 }).notNull(),
  nextReviewDate:   date("next_review_date").notNull(),
  lastReviewedAt:   timestamp("last_reviewed_at", { withTimezone: true }),
  reviewerRole:     varchar("reviewer_role", { length: 64 }).notNull().default("contract_admin"),
  /** "scheduled" | "completed" | "cancelled" */
  status:           varchar("status", { length: 16 }).notNull().default("scheduled"),
  notes:            text("notes"),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:        uuid("created_by").notNull(),
  updatedBy:        uuid("updated_by").notNull(),
  version:          integer("version").notNull().default(1),
});

export type PenaltyTermRow          = typeof penaltyTerms.$inferSelect;
export type PenaltyTermInsert       = typeof penaltyTerms.$inferInsert;
export type PenaltyApplicationRow   = typeof penaltyApplications.$inferSelect;
export type PenaltyApplicationInsert = typeof penaltyApplications.$inferInsert;
export type ReviewScheduleRow       = typeof reviewSchedules.$inferSelect;
export type ReviewScheduleInsert    = typeof reviewSchedules.$inferInsert;

export const schema = { penaltyTerms, penaltyApplications, reviewSchedules };
