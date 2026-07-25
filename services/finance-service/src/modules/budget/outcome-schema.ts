import {
  pgSchema, uuid, text, integer, bigint, char, varchar, timestamp, date,
} from "drizzle-orm/pg-core";

// Reuse the existing "budget" pg schema namespace.
export const budgetOutcomeSchema = pgSchema("budget");

/**
 * SVC-040 — output/outcome budgeting. Each row ties a slice of a budget
 * allocation (allocated_minor) to an OUTPUT (deliverable) and the OUTCOME it is
 * meant to produce, measured by an INDICATOR with a TARGET, tracked ACHIEVEMENT,
 * and a maker-checker EVALUATION.
 */
export const financeBudgetOutcomes = budgetOutcomeSchema.table("finance_budget_outcomes", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  headId:          uuid("head_id").notNull(),
  fy:              char("fy", { length: 7 }).notNull(),
  allocationId:    uuid("allocation_id"),          // optional link to finance_budget_allocation
  schemeId:        uuid("scheme_id"),              // optional link to finance_schemes
  outputDesc:      text("output_desc").notNull(),  // the funded deliverable
  outcomeDesc:     text("outcome_desc").notNull(), // the intended impact
  indicator:       text("indicator").notNull(),    // measurable indicator
  unit:            text("unit").notNull(),         // unit of measure
  baselineValue:   bigint("baseline_value", { mode: "bigint" }).notNull().default(0n),
  targetValue:     bigint("target_value", { mode: "bigint" }).notNull(),
  achievedValue:   bigint("achieved_value", { mode: "bigint" }).notNull().default(0n),
  allocatedMinor:  bigint("allocated_minor", { mode: "bigint" }).notNull().default(0n),
  currency:        char("currency", { length: 3 }).notNull().default("INR"),
  status:          varchar("status", { length: 24 }).notNull().default("draft"),
  evaluationRating: varchar("evaluation_rating", { length: 24 }),
  evaluationNote:  text("evaluation_note"),
  evaluatedBy:     uuid("evaluated_by"),
  evaluatedAt:     timestamp("evaluated_at", { withTimezone: true }),
  effectiveFrom:   date("effective_from").notNull(),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export type BudgetOutcomeRow    = typeof financeBudgetOutcomes.$inferSelect;
export type BudgetOutcomeInsert = typeof financeBudgetOutcomes.$inferInsert;

export const outcomeSchema = { financeBudgetOutcomes };
