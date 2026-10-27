/**
 * subscriptions module — Drizzle schema. Lives in its OWN Postgres schema `subscriptions`.
 * L2 rule: this module's repo queries ONLY `subscriptions.*`.
 */
import { pgSchema, uuid, varchar, integer, timestamp, text, jsonb } from "drizzle-orm/pg-core";

export const subscriptionsSchema = pgSchema("subscriptions");

export const statusEnum = subscriptionsSchema.enum("subscription_status", [
  "trial", "active", "past_due", "suspended", "cancelled",
]);

export const subscriptions = subscriptionsSchema.table("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  planId: uuid("plan_id").notNull(),
  status: statusEnum("status").notNull().default("trial"),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  endDate: timestamp("end_date", { withTimezone: true }),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  // audit columns
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type SubscriptionInsert = typeof subscriptions.$inferInsert;

/**
 * Owner decision #24: a downgrade is a request that platform billing approves.
 * Mirrors migration 0032 (one pending request per tenant, approver != requester).
 */
export interface UsageCheck { resource: "users" | "storage_gb"; used: number; limit: number }
export const downgradeRequests = subscriptionsSchema.table("downgrade_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  subscriptionId: uuid("subscription_id").notNull(),
  fromPlanId: uuid("from_plan_id").notNull(),
  targetPlanId: uuid("target_plan_id").notNull(),
  reason: text("reason").notNull(),
  usageSnapshot: jsonb("usage_snapshot").$type<{ checks: UsageCheck[] }>().notNull().default({ checks: [] }),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  requestedBy: uuid("requested_by").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionReason: text("decision_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});
export type DowngradeRequestRow = typeof downgradeRequests.$inferSelect;

export const schema = { subscriptions, downgradeRequests };
