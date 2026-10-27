import { pgSchema, uuid, varchar, text, bigint, char, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const plansSchema = pgSchema("plans");
const PLATFORM = "00000000-0000-0000-0000-000000000000";

export const billingPlans = plansSchema.table("billing_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().default(PLATFORM),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  priceMinor: bigint("price_minor", { mode: "bigint" }).notNull().default(0n),
  currency: char("currency", { length: 3 }).notNull().default("INR"),
  govtExempt: boolean("govt_exempt").notNull().default(true),
  // GAP-BILLING-PLANS-NEW-01 (migration 0023): monthly | quarterly | yearly.
  billingInterval: varchar("billing_interval", { length: 12 }).notNull().default("monthly"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const billingPlanFeatures = plansSchema.table("billing_plan_features", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().default(PLATFORM),
  planId: uuid("plan_id").notNull(),
  featureKey: text("feature_key").notNull(),
  limitValue: bigint("limit_value", { mode: "bigint" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type BillingPlanInsert = typeof billingPlans.$inferInsert;
export const schema = { billingPlans, billingPlanFeatures };
