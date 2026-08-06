import { pgSchema, uuid, varchar, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const crmSchema = pgSchema("crm");

export const healthScoreConfigs = crmSchema.table("health_score_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  signalName: varchar("signal_name", { length: 100 }).notNull(),
  weight: integer("weight").notNull(),
  decayDays: integer("decay_days").notNull().default(90),
  source: varchar("source", { length: 20 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accountHealthScores = crmSchema.table("account_health_scores", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  accountId: uuid("account_id").notNull(),
  score: integer("score").notNull(),
  signals: jsonb("signals").$type<Record<string, number>>().notNull().default({}),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HealthScoreConfigRow = typeof healthScoreConfigs.$inferSelect;
export type AccountHealthScoreRow = typeof accountHealthScores.$inferSelect;

export const schema = { healthScoreConfigs, accountHealthScores };
