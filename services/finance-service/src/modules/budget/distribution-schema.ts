import {
  pgSchema, uuid, text, integer, bigint, char, varchar, timestamp, date,
} from "drizzle-orm/pg-core";

export const budgetDistributionSchema = pgSchema("budget");

/**
 * SVC-033 — distribution of an original allocation to a subordinate office.
 * Effective-dated, condition-bearing, and acknowledged by the receiving office.
 */
export const financeAllocationDistributions = budgetDistributionSchema.table("finance_allocation_distributions", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  allocationId:    uuid("allocation_id").notNull(),  // parent finance_budget_allocation
  fy:              char("fy", { length: 7 }).notNull(),
  headId:          uuid("head_id").notNull(),
  fromOfficeId:    uuid("from_office_id").notNull(),
  toOfficeId:      uuid("to_office_id").notNull(),
  amountMinor:     bigint("amount_minor", { mode: "bigint" }).notNull(),
  currency:        char("currency", { length: 3 }).notNull().default("INR"),
  conditions:      text("conditions"),
  status:          varchar("status", { length: 24 }).notNull().default("draft"),
  effectiveFrom:   date("effective_from").notNull(),
  issuedBy:        uuid("issued_by"),
  issuedAt:        timestamp("issued_at", { withTimezone: true }),
  acknowledgedBy:  uuid("acknowledged_by"),
  acknowledgedAt:  timestamp("acknowledged_at", { withTimezone: true }),
  acknowledgeNote: text("acknowledge_note"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export type AllocationDistributionRow    = typeof financeAllocationDistributions.$inferSelect;
export type AllocationDistributionInsert = typeof financeAllocationDistributions.$inferInsert;

export const distributionSchema = { financeAllocationDistributions };
