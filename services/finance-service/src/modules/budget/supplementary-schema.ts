import {
  pgSchema, uuid, text, integer, bigint, char, varchar, timestamp, date,
} from "drizzle-orm/pg-core";

export const budgetSupplementarySchema = pgSchema("budget");

/**
 * SVC-035 — supplementary / additional grant demand. Adds fresh provision to an
 * existing budget head under a sanctioning authority, capped by an optional
 * limit, approved maker-checker; on approval the target budget's BE + RE rise.
 */
export const financeSupplementaryDemands = budgetSupplementarySchema.table("finance_supplementary_demands", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  fy:            char("fy", { length: 7 }).notNull(),
  budgetId:      uuid("budget_id").notNull(),   // target finance_budgets row
  headId:        uuid("head_id").notNull(),
  amountMinor:   bigint("amount_minor", { mode: "bigint" }).notNull(),
  limitMinor:    bigint("limit_minor", { mode: "bigint" }).notNull().default(0n),
  currency:      char("currency", { length: 3 }).notNull().default("INR"),
  kind:          varchar("kind", { length: 24 }).notNull().default("supplementary"),
  authority:     text("authority").notNull(),
  reason:        text("reason").notNull(),
  status:        varchar("status", { length: 24 }).notNull().default("pending_approval"),
  approvedBy:    uuid("approved_by"),
  approvedAt:    timestamp("approved_at", { withTimezone: true }),
  rejectReason:  text("reject_reason"),
  effectiveFrom: date("effective_from").notNull(),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export type SupplementaryDemandRow    = typeof financeSupplementaryDemands.$inferSelect;
export type SupplementaryDemandInsert = typeof financeSupplementaryDemands.$inferInsert;

export const supplementarySchema = { financeSupplementaryDemands };
