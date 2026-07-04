/**
 * plans module — Drizzle schema. Lives in its OWN Postgres schema `plans`.
 * L2 rule: this module's repo queries ONLY `plans.*`. No other module may import this file.
 */
import { pgSchema, uuid, varchar, integer, bigint, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";

export const plansSchema = pgSchema("plans");

export const editionEnum = plansSchema.enum("edition", ["small_office", "psu", "govt_dept"]);
export const billingCycleEnum = plansSchema.enum("billing_cycle", ["monthly", "quarterly", "annual"]);

export const plans = plansSchema.table("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  edition: editionEnum("edition").notNull(),
  maxUsers: integer("max_users").notNull(),
  maxStorageGb: integer("max_storage_gb").notNull(),
  enabledModules: jsonb("enabled_modules").$type<string[]>().notNull().default([]),
  priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(), // amount in paise (INR minor units)
  billingCycle: billingCycleEnum("billing_cycle").notNull().default("annual"),
  features: jsonb("features").$type<Record<string, unknown>>().notNull().default({}),
  // audit columns
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type PlanRow = typeof plans.$inferSelect;
export type PlanInsert = typeof plans.$inferInsert;

export const schema = { plans };
