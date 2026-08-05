/**
 * templates module — Drizzle schema for report_templates in `reports` Postgres schema.
 * Supports parameterized report builder with data sources, filters, groups, aggregations.
 */
import { pgSchema, uuid, varchar, integer, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";

export const domainSchema = pgSchema("reports");

export const outputFormatEnum = pgEnum("report_output_format", ["pdf", "xlsx", "csv"]);

export const templateStatusEnum = pgEnum("report_template_status", ["active", "draft", "archived"]);

export const reportTemplates = domainSchema.table("report_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  description: varchar("description", { length: 1000 }),
  dataSourceId: varchar("data_source_id", { length: 128 }).notNull(),
  filters: jsonb("filters").notNull().default([]),
  groups: jsonb("groups").notNull().default([]),
  aggregations: jsonb("aggregations").notNull().default([]),
  parameters: jsonb("parameters").notNull().default([]),
  formulas: jsonb("formulas").notNull().default([]),
  chartConfig: jsonb("chart_config"),
  outputFormat: varchar("output_format", { length: 8 }).notNull().default("pdf"),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  /** Optional watermark text overlaid on exports */
  watermark: varchar("watermark", { length: 200 }),
  /** JSON array of column keys containing PII to mask for non-privileged roles */
  piiColumns: jsonb("pii_columns"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull(),
  updatedBy: uuid("updated_by").notNull(),
  version: integer("version").notNull().default(1),
});

export type TemplateRow = typeof reportTemplates.$inferSelect;
export type TemplateInsert = typeof reportTemplates.$inferInsert;

/** Filter definition stored in the filters JSONB column */
export interface TemplateFilter {
  field: string;
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "between" | "like";
  value: unknown;
}

/** Group dimension stored in the groups JSONB column */
export interface TemplateGroup {
  field: string;
  label?: string;
}

/** Aggregation definition stored in the aggregations JSONB column */
export interface TemplateAggregation {
  field: string;
  function: "count" | "sum" | "avg" | "min" | "max";
  alias?: string;
}

/** Parameter definition stored in the parameters JSONB column */
export interface TemplateParameter {
  name: string;
  type: "string" | "number" | "date" | "enum";
  required: boolean;
  defaultValue?: unknown;
  options?: string[];
}

/** Formula (computed column) definition stored in the formulas JSONB column */
export interface TemplateFormula {
  name: string;
  expression: string;
  type: "number" | "percentage" | "currency";
}

/** Chart configuration stored in the chart_config JSONB column */
export interface TemplateChartConfig {
  type: "bar" | "line" | "pie" | "area" | "scatter" | "funnel" | "table";
  xAxis?: string;
  yAxis?: string;
  series?: string[];
  colorScheme?: string;
  stacked?: boolean;
}

export interface TemplateView {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  dataSourceId: string;
  filters: TemplateFilter[];
  groups: TemplateGroup[];
  aggregations: TemplateAggregation[];
  parameters: TemplateParameter[];
  formulas: TemplateFormula[];
  chartConfig: TemplateChartConfig | null;
  outputFormat: string;
  status: string;
  watermark: string | null;
  piiColumns: string[] | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
}

export const schema = { reportTemplates };
