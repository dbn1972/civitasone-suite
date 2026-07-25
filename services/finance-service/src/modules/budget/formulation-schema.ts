import {
  pgSchema, uuid, text, integer, bigint, char, varchar, timestamp, date,
} from "drizzle-orm/pg-core";

export const budgetFormulationSchema = pgSchema("budget");

/**
 * SVC-031 — departmental budget proposal. Raised against a communicated
 * `ceiling_minor`, carries a `proposed_minor` demand + justification, is
 * versioned (parent_id chains revisions), routed through review, and approved
 * by a maker-checker distinct from the raiser.
 */
export const financeBudgetProposals = budgetFormulationSchema.table("finance_budget_formulation", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  fy:             char("fy", { length: 7 }).notNull(),
  deptCode:       text("dept_code").notNull(),
  headId:         uuid("head_id").notNull(),
  ceilingMinor:   bigint("ceiling_minor", { mode: "bigint" }).notNull().default(0n),
  proposedMinor:  bigint("proposed_minor", { mode: "bigint" }).notNull().default(0n),
  currency:       char("currency", { length: 3 }).notNull().default("INR"),
  justification:  text("justification").notNull().default(""),
  status:         varchar("status", { length: 24 }).notNull().default("draft"),
  parentId:       uuid("parent_id"),         // previous version (revision chain)
  reviewNote:     text("review_note"),
  reviewedBy:     uuid("reviewed_by"),
  reviewedAt:     timestamp("reviewed_at", { withTimezone: true }),
  approvedBy:     uuid("approved_by"),
  approvedAt:     timestamp("approved_at", { withTimezone: true }),
  effectiveFrom:  date("effective_from").notNull(),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export type BudgetProposalRow    = typeof financeBudgetProposals.$inferSelect;
export type BudgetProposalInsert = typeof financeBudgetProposals.$inferInsert;

export const formulationSchema = { financeBudgetProposals };
