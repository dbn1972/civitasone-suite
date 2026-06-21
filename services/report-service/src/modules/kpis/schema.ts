import { pgSchema, uuid, varchar, numeric, integer, timestamp } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("reports");

export const kpis = domainSchema.table("kpis", {
  id:           uuid("id").primaryKey().defaultRandom(),
  tenantId:     uuid("tenant_id").notNull(),
  kpiName:      varchar("kpi_name", { length: 200 }).notNull(),
  module:       varchar("module", { length: 64 }).notNull(),
  targetValue:  numeric("target_value").notNull().default("0"),
  currentValue: numeric("current_value").notNull().default("0"),
  unit:         varchar("unit", { length: 32 }).notNull().default(""),
  period:       varchar("period", { length: 32 }).notNull().default(""),
  trend:        varchar("trend", { length: 16 }).notNull().default("stable"),
  status:       varchar("status", { length: 16 }).notNull().default("on_track"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:    uuid("created_by").notNull(),
  updatedBy:    uuid("updated_by").notNull(),
  version:      integer("version").notNull().default(1),
});

export type KpiRow = typeof kpis.$inferSelect;
export const schema = { kpis };
