/**
 * Analytics schema — persisted forecast runs.
 *
 * PG schema: `analytics`
 * _Requirements: SVC-140_
 */
import {
  pgSchema, uuid, integer, varchar, timestamp, bigint, jsonb,
} from "drizzle-orm/pg-core";

export const analyticsSchema = pgSchema("analytics");

// ── analytics.forecast_runs ────────────────────────────────────────────────────
export const forecastRuns = analyticsSchema.table("forecast_runs", {
  id:              uuid("id").primaryKey().defaultRandom(),
  tenantId:        uuid("tenant_id").notNull(),
  /** Optional scope: forecast for a single rate head, else whole-tenant. */
  rateHeadId:      uuid("rate_head_id"),
  method:          varchar("method", { length: 24 }).notNull(), // moving_average | straight_line | seasonal_naive
  granularity:     varchar("granularity", { length: 12 }).notNull(), // month | fy
  horizon:         integer("horizon").notNull(),
  param:           integer("param").notNull().default(3),
  historyPeriods:  integer("history_periods").notNull(),
  /** Historical input series (paise as decimal strings) for reproducibility. */
  historySeries:   jsonb("history_series").notNull().default([]),
  /** Projections: [{ index, projectionMinor, lowerMinor, upperMinor }] as strings. */
  projections:     jsonb("projections").notNull().default([]),
  madMinor:        bigint("mad_minor", { mode: "bigint" }).notNull(),
  confidenceBps:   integer("confidence_bps").notNull(),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy:       uuid("created_by").notNull(),
});

export type ForecastRunRow = typeof forecastRuns.$inferSelect;
export type ForecastRunInsert = typeof forecastRuns.$inferInsert;

export const schema = { forecastRuns };
