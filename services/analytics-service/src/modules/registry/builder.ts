/**
 * SAFE QUERY BUILDER.
 *
 * Translates a validated QuerySpec into a parameterised Drizzle query against
 * analytics.fact_events. Security invariants enforced here (proven by tests):
 *
 *   • Tenant predicate is ALWAYS present and bound — no spec can remove it, so
 *     a user can never read another tenant's rows.
 *   • Every selected/grouped/filtered identifier comes from the registry as a
 *     concrete column object. User strings only pick a key; they never become
 *     SQL identifiers.
 *   • Every filter value is a bound parameter ($1…), never concatenated.
 *
 * The result is a normal Drizzle query: call `.toSQL()` to inspect the compiled
 * SQL + params (used by tests), or `await` it to execute.
 */
import { and, eq, ne, gt, gte, lt, lte, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "../../shared/db.js";
import { factEvents } from "../facts/schema.js";
import {
  resolveMetric,
  resolveDimension,
  resolveFilterField,
  RegistryError,
  type FilterFieldDef,
} from "./registry.js";
import type { FilterSpec, QuerySpec, QueryResult, QueryResultRow } from "./spec.js";

/** Build the aggregate SQL expression for a metric over its whitelisted column. */
function metricExpr(metricKey: string): SQL<number> {
  const m = resolveMetric(metricKey);
  switch (m.agg) {
    case "count":
      return sql<number>`count(*)::float8`;
    case "sum":
      return sql<number>`coalesce(sum(${m.column}), 0)::float8`;
    case "avg":
      return sql<number>`coalesce(avg(${m.column}), 0)::float8`;
    case "max":
      return sql<number>`coalesce(max(${m.column}), 0)::float8`;
    case "min":
      return sql<number>`coalesce(min(${m.column}), 0)::float8`;
  }
}

/** Coerce a user value to the field's declared type (defensive; zod already gates shape). */
function coerce(def: FilterFieldDef, value: unknown): string | number {
  if (def.type === "number") {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) throw new RegistryError("BAD_FILTER_VALUE", `expected number for ${def.key}`);
    return n;
  }
  // string + date are bound as text/timestamp params.
  return String(value);
}

function buildCondition(f: FilterSpec): SQL {
  const def = resolveFilterField(f.field); // throws on non-whitelisted field
  const col = def.column;

  if (f.op === "in") {
    const arr = Array.isArray(f.value) ? f.value : [f.value];
    const values = arr.map((v) => coerce(def, v));
    if (values.length === 0) throw new RegistryError("BAD_FILTER_VALUE", `empty 'in' list for ${def.key}`);
    return inArray(col, values);
  }

  const v = coerce(def, f.value);
  switch (f.op) {
    case "eq":
      return eq(col, v);
    case "neq":
      return ne(col, v);
    case "gt":
      return gt(col, v);
    case "gte":
      return gte(col, v);
    case "lt":
      return lt(col, v);
    case "lte":
      return lte(col, v);
  }
}

function buildSelect(db: Db, tenantId: string, spec: QuerySpec) {
  const dims = spec.dimensions.map(resolveDimension); // throws on non-whitelisted

  // SELECT: each whitelisted dimension column + the metric aggregate as "value".
  const selection: Record<string, unknown> = {};
  for (const d of dims) selection[d.key] = d.column;
  selection.value = metricExpr(spec.metric);

  // WHERE: tenant predicate ALWAYS first; then whitelisted, parameterised filters.
  const conds: SQL[] = [eq(factEvents.tenantId, tenantId)];
  for (const f of spec.filters) conds.push(buildCondition(f));
  if (spec.dateFrom) conds.push(gte(factEvents.occurredAt, new Date(spec.dateFrom)));
  if (spec.dateTo) conds.push(lte(factEvents.occurredAt, new Date(spec.dateTo)));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = db.select(selection as any).from(factEvents).where(and(...conds));
  if (dims.length > 0) q = q.groupBy(...dims.map((d) => d.column));
  q = q.limit(spec.limit);
  return q;
}

/**
 * Compile (but do not execute) the query for a tenant. Throws RegistryError if
 * the spec references anything outside the whitelist.
 */
export function buildAggregateQuery(db: Db, tenantId: string, spec: QuerySpec) {
  return buildSelect(db, tenantId, spec);
}

/** Execute the query and normalise rows to numbers for the metric value. */
export async function runAggregateQuery(db: Db, tenantId: string, spec: QuerySpec): Promise<QueryResult> {
  const rows = (await buildAggregateQuery(db, tenantId, spec)) as Array<Record<string, unknown>>;
  const normalised: QueryResultRow[] = rows.map((r) => {
    const out: QueryResultRow = {};
    for (const d of spec.dimensions) out[d] = r[d] == null ? "—" : String(r[d]);
    out.value = typeof r.value === "number" ? r.value : Number(r.value ?? 0);
    return out;
  });
  return { metric: spec.metric, dimensions: spec.dimensions, rows: normalised, rowCount: normalised.length };
}
