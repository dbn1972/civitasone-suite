import { pgSchema, uuid, text, bigint, char, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const usageSchema = pgSchema("usage");

export const billingUsageEvents = usageSchema.table("billing_usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  metricKey: text("metric_key").notNull(),
  quantity: bigint("quantity", { mode: "bigint" }).notNull().default(1n),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const billingUsageAggregates = usageSchema.table("billing_usage_aggregates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  metricKey: text("metric_key").notNull(),
  periodMonth: char("period_month", { length: 7 }).notNull(),
  totalQuantity: bigint("total_quantity", { mode: "bigint" }).notNull().default(0n),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export const schema = { billingUsageEvents, billingUsageAggregates };
