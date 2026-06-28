import {
  pgSchema, uuid, text, integer, bigint, char, varchar, timestamp,
} from "drizzle-orm/pg-core";

export const budgetSchema = pgSchema("budget");

export const financeHeads = budgetSchema.table("finance_heads", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  code:           text("code").notNull(),
  hoaCode:        char("hoa_code", { length: 18 }),
  name:           text("name").notNull(),
  level:          integer("level").notNull(),        // 0=major 1=minor 2=sub
  classification: text("classification"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export const financeBudgets = budgetSchema.table("finance_budgets", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  headId:          uuid("head_id").notNull(),
  fy:              char("fy", { length: 7 }).notNull(),
  beMinor:         bigint("be_minor", { mode: "bigint" }).notNull().default(0n),
  reMinor:         bigint("re_minor", { mode: "bigint" }).notNull().default(0n),
  allocatedMinor:  bigint("allocated_minor", { mode: "bigint" }).notNull().default(0n),
  utilisedMinor:   bigint("utilised_minor", { mode: "bigint" }).notNull().default(0n),
  currency:        char("currency", { length: 3 }).notNull().default("INR"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
  updatedBy:       uuid("updated_by").notNull(),
  version:         integer("version").notNull().default(1),
});

export const financeDemands = budgetSchema.table("finance_demands", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  demandNo:    text("demand_no").notNull(),
  service:     text("service").notNull(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  currency:    char("currency", { length: 3 }).notNull().default("INR"),
  class:       text("class").notNull().default("voted"),
  status:      varchar("status", { length: 24 }).notNull().default("draft"),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const financeSchemes = budgetSchema.table("finance_schemes", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  code:           text("code").notNull(),
  name:           text("name").notNull(),
  outlayMinor:    bigint("outlay_minor", { mode: "bigint" }).notNull().default(0n),
  utilisedMinor:  bigint("utilised_minor", { mode: "bigint" }).notNull().default(0n),
  currency:       char("currency", { length: 3 }).notNull().default("INR"),
  funding:        text("funding"),
  status:         varchar("status", { length: 24 }).notNull().default("active"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

export const financeSanctions = budgetSchema.table("finance_sanctions", {
  id:             uuid("id").primaryKey().defaultRandom(),
  tenantId:       uuid("tenant_id").notNull(),
  sanctionNo:     text("sanction_no").notNull(),
  purpose:        text("purpose").notNull(),
  headId:         uuid("head_id").notNull(),
  amountMinor:    bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  utilisedMinor:  bigint("utilised_minor", { mode: "bigint" }).notNull().default(0n),
  currency:       char("currency", { length: 3 }).notNull().default("INR"),
  status:         varchar("status", { length: 24 }).notNull().default("draft"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:      uuid("created_by").notNull(),
  updatedBy:      uuid("updated_by").notNull(),
  version:        integer("version").notNull().default(1),
});

/**
 * Re-appropriation request — a standalone, status-bearing entity so a budget
 * re-appropriation can be routed through eOffice for administrative approval
 * before it touches the target budget. `reappropriateBudget` applies a change
 * directly; this request defers that effect until the eOffice file is decided.
 *
 * `amount_minor` carries the new revised-estimate target (paise) to set on the
 * target budget's `re_minor` when the request is approved — same semantics as
 * the `reMinor` field on the direct re-appropriation path.
 */
export const financeReappropriations = budgetSchema.table("finance_reappropriations", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  budgetId:     uuid("budget_id").notNull(),       // target budget whose re_minor is updated on approval
  headId:       uuid("head_id"),                   // reference head (nullable — for audit/reporting)
  amountMinor:  bigint("amount_minor", { mode: "bigint" }).notNull().default(0n),
  reason:       text("reason").notNull(),
  status:       varchar("status", { length: 24 }).notNull().default("pending_approval"), // pending_approval|approved|rejected
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export type HeadRow      = typeof financeHeads.$inferSelect;
export type HeadInsert   = typeof financeHeads.$inferInsert;
export type BudgetRow    = typeof financeBudgets.$inferSelect;
export type BudgetInsert = typeof financeBudgets.$inferInsert;
export type SanctionRow  = typeof financeSanctions.$inferSelect;
export type SanctionInsert = typeof financeSanctions.$inferInsert;
export type ReappropriationRow    = typeof financeReappropriations.$inferSelect;
export type ReappropriationInsert = typeof financeReappropriations.$inferInsert;

export const schema = { financeHeads, financeBudgets, financeDemands, financeSchemes, financeSanctions, financeReappropriations };
