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
 *
 * Lookups below use Object.prototype.hasOwnProperty (never `key in obj` and
 * never a bare `obj[key]` truthiness check): plain-object property lookups
 * fall through to Object.prototype for names like "__proto__", "constructor"
 * or "toString", and both `in` and a direct index both resolve those to a
 * real (truthy) value instead of failing the whitelist. Confirmed live: a
 * join key of "__proto__" or "constructor" reached resolveDimension()/
 * resolveFilterField() as if valid, produced a column of `undefined`, and
 * crashed the query with a Postgres "syntax error at or near '='" — an
 * authenticated-user-triggerable 500 on POST /v1/analytics/query. Hardening
 * the lookup here closes it at the root for every caller.
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

/** True only for an OWN enumerable key — safe against "__proto__" etc. */
function hasKey(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** True iff `key` is an own key of ANY of the given objects. Exported for
 * callers (e.g. join-condition validation) that whitelist across more than
 * one registry map without wanting to re-implement the hasOwnProperty check. */
export function hasKeyIn(objs: object[], key: string): boolean {
  return objs.some((obj) => hasKey(obj, key));
}

/** Thrown when user input references a non-whitelisted identifier. */
export class RegistryError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "RegistryError";
  }
}

export function resolveMetric(key: string): MetricDef {
  if (!hasKey(METRICS, key)) throw new RegistryError("UNKNOWN_METRIC", `unknown metric: ${key}`);
  // Non-null: hasKey() just confirmed `key` is an own property of METRICS.
  // TS's indexed-access type on Record<string, T> can't narrow through an
  // arbitrary function call, so it still sees `T | undefined` here.
  return METRICS[key]!;
}

export function resolveDimension(key: string): DimensionDef {
  if (!hasKey(DIMENSIONS, key)) throw new RegistryError("UNKNOWN_DIMENSION", `unknown dimension: ${key}`);
  return DIMENSIONS[key]!;
}

export function resolveFilterField(key: string): FilterFieldDef {
  if (!hasKey(FILTERS, key)) throw new RegistryError("UNKNOWN_FILTER", `unknown filter field: ${key}`);
  return FILTERS[key]!;
}

/**
 * Resolve a key that may be either a group-by dimension or a filterable field
 * (used by join conditions, which may correlate on either kind of column).
 * Never returns undefined — always resolves to a real whitelisted column or
 * throws, so callers can't accidentally build SQL around a missing column.
 */
export function resolveDimensionOrFilter(key: string): { key: string; column: PgColumn } {
  if (hasKey(DIMENSIONS, key)) return DIMENSIONS[key]!;
  if (hasKey(FILTERS, key)) return FILTERS[key]!;
  throw new RegistryError("UNREGISTERED_IDENTIFIER", `'${key}' is not a whitelisted dimension or filter field`);
}

/** True iff `key` is an own key of METRICS, DIMENSIONS or FILTERS. */
export function isWhitelistedIdentifier(key: string): boolean {
  return hasKey(METRICS, key) || hasKey(DIMENSIONS, key) || hasKey(FILTERS, key);
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
