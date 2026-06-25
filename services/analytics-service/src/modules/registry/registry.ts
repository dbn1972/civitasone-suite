/**
 * METRIC / DIMENSION REGISTRY — the security core of the analytics query path.
 *
 * Analytics runs *user-defined* queries. The non-negotiable guarantee is that a
 * user can NEVER inject raw SQL and can NEVER read another tenant's data. We
 * achieve this with two rules, both enforced here and in the query builder:
 *
 *   1. WHITELIST IDENTIFIERS. Every metric, dimension and filterable field a
 *      user may reference is declared in this registry and mapped to a concrete
 *      Drizzle column object. User input only ever selects a *key*; it never
 *      supplies a column name, table name, function or SQL fragment. An unknown
 *      key is rejected before any query is built.
 *
 *   2. PARAMETERISE VALUES. Filter values flow through Drizzle's bound
 *      parameters ($1, $2, …) — never string-concatenated into SQL.
 *
 * Combined with the always-on tenant predicate in the builder, this makes SQL
 * injection and cross-tenant reads structurally impossible, not merely unlikely.
 */
import type { PgColumn } from "drizzle-orm/pg-core";
import { factEvents } from "../facts/schema.js";

export type AggFn = "count" | "sum" | "avg" | "min" | "max";

export interface MetricDef {
  key: string;
  label: string;
  agg: AggFn;
  /** Physical column the aggregate runs over (ignored for count). */
  column: PgColumn;
}

export interface DimensionDef {
  key: string;
  label: string;
  column: PgColumn;
}

export type FilterType = "string" | "number" | "date";

export interface FilterFieldDef {
  key: string;
  label: string;
  column: PgColumn;
  type: FilterType;
}

/** Whitelisted metrics — the ONLY aggregations a user may request. */
export const METRICS: Record<string, MetricDef> = {
  event_count: { key: "event_count", label: "Event count", agg: "count", column: factEvents.id },
  amount_sum: { key: "amount_sum", label: "Total amount", agg: "sum", column: factEvents.amount },
  amount_avg: { key: "amount_avg", label: "Average amount", agg: "avg", column: factEvents.amount },
  amount_max: { key: "amount_max", label: "Max amount", agg: "max", column: factEvents.amount },
  amount_min: { key: "amount_min", label: "Min amount", agg: "min", column: factEvents.amount },
};

/** Whitelisted group-by dimensions. */
export const DIMENSIONS: Record<string, DimensionDef> = {
  source: { key: "source", label: "Source", column: factEvents.source },
  event_type: { key: "event_type", label: "Event type", column: factEvents.eventType },
  category: { key: "category", label: "Category", column: factEvents.category },
  status: { key: "status", label: "Status", column: factEvents.status },
};

/** Whitelisted filterable fields. */
export const FILTERS: Record<string, FilterFieldDef> = {
  source: { key: "source", label: "Source", column: factEvents.source, type: "string" },
  event_type: { key: "event_type", label: "Event type", column: factEvents.eventType, type: "string" },
  category: { key: "category", label: "Category", column: factEvents.category, type: "string" },
  status: { key: "status", label: "Status", column: factEvents.status, type: "string" },
  amount: { key: "amount", label: "Amount", column: factEvents.amount, type: "number" },
  occurred_at: { key: "occurred_at", label: "Occurred at", column: factEvents.occurredAt, type: "date" },
};

export const OPERATORS = ["eq", "neq", "gt", "gte", "lt", "lte", "in"] as const;
export type Operator = (typeof OPERATORS)[number];

export const METRIC_KEYS = Object.keys(METRICS) as [string, ...string[]];
export const DIMENSION_KEYS = Object.keys(DIMENSIONS) as [string, ...string[]];
export const FILTER_KEYS = Object.keys(FILTERS) as [string, ...string[]];

/** Thrown when user input references a non-whitelisted identifier. */
export class RegistryError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "RegistryError";
  }
}

export function resolveMetric(key: string): MetricDef {
  const def = METRICS[key];
  if (!def) throw new RegistryError("UNKNOWN_METRIC", `unknown metric: ${key}`);
  return def;
}

export function resolveDimension(key: string): DimensionDef {
  const def = DIMENSIONS[key];
  if (!def) throw new RegistryError("UNKNOWN_DIMENSION", `unknown dimension: ${key}`);
  return def;
}

export function resolveFilterField(key: string): FilterFieldDef {
  const def = FILTERS[key];
  if (!def) throw new RegistryError("UNKNOWN_FILTER", `unknown filter field: ${key}`);
  return def;
}

/** Machine-readable catalog for the UI / API discovery endpoint. */
export function catalog() {
  return {
    metrics: Object.values(METRICS).map((m) => ({ key: m.key, label: m.label, agg: m.agg })),
    dimensions: Object.values(DIMENSIONS).map((d) => ({ key: d.key, label: d.label })),
    filters: Object.values(FILTERS).map((f) => ({ key: f.key, label: f.label, type: f.type })),
    operators: [...OPERATORS],
  };
}
