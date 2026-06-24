import {
  pgSchema, uuid, text, integer, bigint, char, timestamp, boolean,
} from "drizzle-orm/pg-core";

// Reuse the existing "budget" pg schema namespace.
export const budgetAllocSchema = pgSchema("budget");

export const financeBudgetAllocation = budgetAllocSchema.table("finance_budget_allocation", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  headId:         uuid("head_id").notNull(),
  fy:             char("fy", { length: 7 }).notNull(),
  allocatedMinor: bigint("allocated_minor", { mode: "bigint" }).notNull().default(0n),
  committedMinor: bigint("committed_minor", { mode: "bigint" }).notNull().default(0n),
  actualMinor:    bigint("actual_minor", { mode: "bigint" }).notNull().default(0n),
  enforce:        boolean("enforce").notNull().default(true),
  currency:       char("currency", { length: 3 }).notNull().default("INR"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export const financeReappropriationLog = budgetAllocSchema.table("finance_reappropriation_log", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  fy:           char("fy", { length: 7 }).notNull(),
  fromHeadId:   uuid("from_head_id").notNull(),
  toHeadId:     uuid("to_head_id").notNull(),
  amountMinor:  bigint("amount_minor", { mode: "bigint" }).notNull(),
  reason:       text("reason"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
});

export type BudgetAllocationRow    = typeof financeBudgetAllocation.$inferSelect;
export type BudgetAllocationInsert = typeof financeBudgetAllocation.$inferInsert;

export const allocationSchema = { financeBudgetAllocation, financeReappropriationLog };
