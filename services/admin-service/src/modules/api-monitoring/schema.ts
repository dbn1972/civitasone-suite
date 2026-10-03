import { pgSchema, uuid, varchar, integer, bigint, timestamp, primaryKey } from "drizzle-orm/pg-core";

const healthSchema = pgSchema("health");

// Migration 0046. Rollup of gateway traffic per tenant / service / endpoint / minute.
export const apiMetricsMinute = healthSchema.table("api_metrics_minute", {
  tenantId: uuid("tenant_id").notNull(),
  bucketMinute: timestamp("bucket_minute", { withTimezone: true }).notNull(),
  service: varchar("service", { length: 64 }).notNull(),
  endpoint: varchar("endpoint", { length: 200 }).notNull(),
  requests: integer("requests").notNull().default(0),
  errors4xx: integer("errors_4xx").notNull().default(0),
  errors5xx: integer("errors_5xx").notNull().default(0),
  latencySumMs: bigint("latency_sum_ms", { mode: "number" }).notNull().default(0),
  latencyBuckets: integer("latency_buckets").array().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.tenantId, t.bucketMinute, t.service, t.endpoint] }) }));

export const apiMetricsSettings = healthSchema.table("api_metrics_settings", {
  tenantId: uuid("tenant_id").primaryKey(),
  retentionDays: integer("retention_days").notNull().default(30),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const schema = { apiMetricsMinute, apiMetricsSettings };
