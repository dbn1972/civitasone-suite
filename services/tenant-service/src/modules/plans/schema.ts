/**
 * plans module — Drizzle schema. Lives in its OWN Postgres schema `plans`.
 * L2 rule: this module's repo queries ONLY `plans.*`. No other module may import this file.
 */
import { pgSchema, uuid, varchar, integer, bigint, timestamp, jsonb, unique, date, text, char } from "drizzle-orm/pg-core";

export const plansSchema = pgSchema("plans");

export const editionEnum = plansSchema.enum("edition", ["small_office", "psu", "govt_dept"]);
export const billingCycleEnum = plansSchema.enum("billing_cycle", ["monthly", "quarterly", "annual"]);

export const plans = plansSchema.table("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  // GAP2-TENANT-PLANS-UNIQUE-05: code is unique PER TENANT, not globally — see
  // the composite constraint below (migration 0028). A per-tenant catalogue
  // must let two tenants each hold the same plan code (e.g. 'PSU').
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  edition: editionEnum("edition").notNull(),
  maxUsers: integer("max_users").notNull(),
  maxStorageGb: integer("max_storage_gb").notNull(),
  enabledModules: jsonb("enabled_modules").$type<string[]>().notNull().default([]),
  priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(), // amount in paise (INR minor units)
  billingCycle: billingCycleEnum("billing_cycle").notNull().default("annual"),
  features: jsonb("features").$type<Record<string, unknown>>().notNull().default({}),
  // M6: catalogue module ids this plan is sold as. NULL = derive from enabledModules (every plan that predates 0036).
  catalogueModules: jsonb("catalogue_modules").$type<string[] | null>(),
  // audit columns
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
}, (t) => ({
  // Mirrors migration 0028_plans_unique_tenant_code.sql: UNIQUE(tenant_id, code).
  tenantCodeUq: unique("plans_tenant_code_key").on(t.tenantId, t.code),
}));

/**
 * M6 price store (migration 0036). Net price in paise (INR minor units); GST rate in basis points is stored on the
 * row so GST shows separately. Effective-dated and append-only: a new price closes the previous open one.
 * subjectKey is the plan code (subjectKind=plan) or the catalogue module id (subjectKind=addon).
 */
export const planPrices = plansSchema.table("plan_prices", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  subjectKind: varchar("subject_kind", { length: 8 }).$type<"plan" | "addon">().notNull(),
  subjectKey: varchar("subject_key", { length: 64 }).notNull(),
  billingCycle: billingCycleEnum("billing_cycle").notNull().default("annual"),
  currency: char("currency", { length: 3 }).notNull().default("INR"),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  gstRateBps: integer("gst_rate_bps").notNull().default(1800),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  effectiveTo: date("effective_to", { mode: "string" }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
});

export type PlanPriceRow = typeof planPrices.$inferSelect;
export type PlanRow = typeof plans.$inferSelect;
export type PlanInsert = typeof plans.$inferInsert;

export const schema = { plans, planPrices };
