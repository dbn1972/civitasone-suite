/**
 * visitor-service: analytics module — Drizzle table definition.
 *
 * Defines `visitor.daily_metrics` matching migration
 * 0006_incidents_dpdp_analytics.sql exactly.
 */
import { pgSchema, uuid, varchar, integer, timestamp } from "drizzle-orm/pg-core";

export const visitorSchema = pgSchema("visitor");

export const dailyMetrics = visitorSchema.table("daily_metrics", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  locationId: uuid("location_id").notNull(),
  date: timestamp("date", { withTimezone: true }).notNull(),
  totalVisits: integer("total_visits").notNull().default(0),
  uniqueVisitors: integer("unique_visitors").notNull().default(0),
  avgApprovalTimeMs: integer("avg_approval_time_ms"),
  avgVisitDurationMs: integer("avg_visit_duration_ms"),
  peakHour: integer("peak_hour"),
  noShowCount: integer("no_show_count").notNull().default(0),
  rejectedCount: integer("rejected_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DailyMetricRow = typeof dailyMetrics.$inferSelect;
export type DailyMetricInsert = typeof dailyMetrics.$inferInsert;

export const schema = { dailyMetrics };
