import {
  pgSchema, uuid, varchar, integer, timestamp, date, numeric,
} from "drizzle-orm/pg-core";

export const analyticsSchema = pgSchema("analytics");

export const citizenSlaConfigs = analyticsSchema.table("citizen_sla_configs", {
  id:          uuid("id").primaryKey().defaultRandom(),
  tenantId:    uuid("tenant_id").notNull(),
  serviceType: varchar("service_type", { length: 64 }).notNull(),
  maxDays:     integer("max_days").notNull(),
  createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:   uuid("created_by").notNull(),
  updatedBy:   uuid("updated_by").notNull(),
  version:     integer("version").notNull().default(1),
});

export const citizenDeliveryMetrics = analyticsSchema.table("citizen_delivery_metrics", {
  id:            uuid("id").primaryKey().defaultRandom(),
  tenantId:      uuid("tenant_id").notNull(),
  serviceType:   varchar("service_type", { length: 64 }).notNull(),
  departmentRef: varchar("department_ref", { length: 128 }),
  pendingCount:  integer("pending_count").notNull().default(0),
  resolvedCount: integer("resolved_count").notNull().default(0),
  avgDays:       numeric("avg_days", { precision: 8, scale: 2 }).notNull().default("0"),
  periodDate:    date("period_date").notNull(),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:     uuid("created_by").notNull(),
  updatedBy:     uuid("updated_by").notNull(),
  version:       integer("version").notNull().default(1),
});

export type SlaConfigRow    = typeof citizenSlaConfigs.$inferSelect;
export type DeliveryMetricRow = typeof citizenDeliveryMetrics.$inferSelect;

export const schema = { citizenSlaConfigs, citizenDeliveryMetrics };
