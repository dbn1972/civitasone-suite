import { pgSchema, uuid, varchar, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const dueHorizonConfigs = crmSchema.table("due_horizon_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  horizons: jsonb("horizons").notNull().$type<number[]>().default([60, 30, 7]),
  groupBy: varchar("group_by", { length: 20 }).notNull().default("product"),
  consentRequired: boolean("consent_required").notNull().default(true),
  active: boolean("active").notNull().default(true),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dueHorizonRuns = crmSchema.table("due_horizon_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  configId: uuid("config_id").notNull(),
  horizonDays: integer("horizon_days").notNull(),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  itemsGenerated: integer("items_generated").notNull().default(0),
  status: varchar("status", { length: 16 }).notNull().default("completed"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DueHorizonConfigRow = typeof dueHorizonConfigs.$inferSelect;
export type DueHorizonRunRow = typeof dueHorizonRuns.$inferSelect;

export const schema = { dueHorizonConfigs, dueHorizonRuns };
