/**
 * subscriptions module — Drizzle schema. Lives in its OWN Postgres schema `subscriptions`.
 * L2 rule: this module's repo queries ONLY `subscriptions.*`.
 */
import { pgSchema, uuid, varchar, integer, timestamp, text } from "drizzle-orm/pg-core";

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

export const schema = { subscriptions };
