import { pgSchema, uuid, varchar, date, integer, bigint, timestamp } from "drizzle-orm/pg-core";

export const revenueSchema = pgSchema("revenue");

/**
 * Revenue recognition ledger — one entry per subscription per service period.
 * Tracks total invoiced, recognized (earned), and deferred (unearned) revenue.
 * Invariant: recognizedPaise + deferredPaise === totalAmountPaise at all times.
 */
export const revenueLedger = revenueSchema.table("revenue_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  subscriptionId: uuid("subscription_id").notNull(),
  totalAmountPaise: bigint("total_amount_paise", { mode: "bigint" }).notNull(),
  servicePeriodStart: date("service_period_start").notNull(),
  servicePeriodEnd: date("service_period_end").notNull(),
  totalDays: integer("total_days").notNull(),
  recognizedPaise: bigint("recognized_paise", { mode: "bigint" }).notNull().default(0n),
  deferredPaise: bigint("deferred_paise", { mode: "bigint" }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

/**
 * Daily accrual entries — one row per ledger per calendar day.
 * Sum of all accrual rows for a ledger === ledger.totalAmountPaise.
 */
export const revenueAccruals = revenueSchema.table("revenue_accruals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  ledgerId: uuid("ledger_id").notNull(),
  accrualDate: date("accrual_date").notNull(),
  amountPaise: bigint("amount_paise", { mode: "bigint" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RevenueLedgerInsert = typeof revenueLedger.$inferInsert;
export type RevenueAccrualInsert = typeof revenueAccruals.$inferInsert;
export const schema = { revenueLedger, revenueAccruals };
