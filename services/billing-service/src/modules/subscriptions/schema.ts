import { pgSchema, uuid, varchar, timestamp, integer } from "drizzle-orm/pg-core";

export const subscriptionsSchema = pgSchema("subscriptions");

export const billingSubscriptions = subscriptionsSchema.table("billing_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  planId: uuid("plan_id").notNull(),
  status: varchar("status", { length: 24 }).notNull().default("trial"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const billingTrials = subscriptionsSchema.table("billing_trials", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  subscriptionId: uuid("subscription_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type BillingSubscriptionInsert = typeof billingSubscriptions.$inferInsert;
export type BillingTrialInsert = typeof billingTrials.$inferInsert;
export const schema = { billingSubscriptions, billingTrials };
