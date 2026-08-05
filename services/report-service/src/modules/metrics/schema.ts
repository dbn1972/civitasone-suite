/**
 * metrics module — Drizzle schema for metric_definitions in the `reports` Postgres schema.
 *
 * G4: reports.kpis stores metric *values*. This table stores the *definition* —
 * what a metric means (source, aggregation, dimensions, period) so that two
 * tenants computing "the same" KPI can be compared against one governed
 * definition.
 *
 * SECURITY: numerator_source / denominator_source are OPAQUE logical identifiers,
 * never SQL. Nothing in this module interpolates them into a query.
 */
import { pgSchema, uuid, varchar, text, integer, boolean, numeric, timestamp, jsonb } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("reports");

export const metricDefinitions = domainSchema.table("metric_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  /** Stable machine key, e.g. `crm.lead_to_agreement_cycle_days`. */
  metricKey: varchar("metric_key", { length: 96 }).notNull(),
  displayName: varchar("display_name", { length: 200 }).notNull(),
  description: text("description"),
  /** Owning module — same convention as reports.kpis.module. */
  module: varchar("module", { length: 64 }).notNull(),
  unit: varchar("unit", { length: 32 }).notNull(),
  aggregation: varchar("aggregation", { length: 24 }).notNull(),
  /** Logical source identifier (NOT raw SQL). */
  numeratorSource: varchar("numerator_source", { length: 200 }).notNull(),
  /** Required for ratio/percent aggregations, NULL otherwise. */
  denominatorSource: varchar("denominator_source", { length: 200 }),
  /** JSON array of allowed slice dimension names. */
  dimensions: jsonb("dimensions").notNull().default([]),
  period: varchar("period", { length: 24 }).notNull(),
  targetValue: numeric("target_value"),
  higherIsBetter: boolean("higher_is_better").notNull().default(true),
  /** `canonical` = platform-standard definition, `tenant` = tenant-authored. */
  governance: varchar("governance", { length: 16 }).notNull().default("tenant"),
  /** Definitions are versioned; a new version is a new row, never a destructive edit. */
  versionNumber: integer("version_number").notNull().default(1),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  deprecatedAt: timestamp("deprecated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  /** Optimistic lock. */
  version: integer("version").notNull().default(1),
});

export type MetricDefinitionRow = typeof metricDefinitions.$inferSelect;
export type MetricDefinitionInsert = typeof metricDefinitions.$inferInsert;

/** Serialised read model returned by the API. */
export interface MetricDefinitionView {
  id: string;
  tenantId: string;
  metricKey: string;
  displayName: string;
  description: string | null;
  module: string;
  unit: string;
  aggregation: string;
  numeratorSource: string;
  denominatorSource: string | null;
  dimensions: string[];
  period: string;
  /** Numeric string (or null) — kept as a string so no precision is lost. */
  targetValue: string | null;
  higherIsBetter: boolean;
  governance: string;
  versionNumber: number;
  status: string;
  publishedAt: string | null;
  deprecatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  version: number;
}

export const schema = { metricDefinitions };
