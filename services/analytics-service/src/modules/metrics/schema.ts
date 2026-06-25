import { pgSchema, uuid, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("analytics");

export const savedMetrics = domainSchema.table("saved_metrics", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  metricKey: varchar("metric_key", { length: 64 }).notNull(),
  spec: jsonb("spec").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type SavedMetricRow = typeof savedMetrics.$inferSelect;
export type SavedMetricInsert = typeof savedMetrics.$inferInsert;

export type SavedMetricView = {
  id: string;
  tenantId: string;
  name: string;
  metricKey: string;
  spec: Record<string, unknown>;
  version: number;
};

export const schema = { savedMetrics };
