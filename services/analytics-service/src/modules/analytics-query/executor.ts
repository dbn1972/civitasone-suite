/**
 * Analytics Query Executor
 *
 * Builds and executes analytics queries supporting:
 * - Cross-table joins (self-join on fact_events with different filter criteria)
 * - Calculated fields evaluated post-query
 * - Drill-through from aggregated metrics to detail rows
 *
 * All queries enforce:
 * - Tenant predicate (always-on, via RLS + explicit WHERE)
 * - Row caps (1000 for joins, 200 for drill-through)
 * - Whitelisted identifiers only
 */
import { and, eq, ne, gt, gte, lt, lte, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "../../shared/db.js";
import { factEvents } from "../facts/schema.js";
import { queryRuns } from "../queries/schema.js";
import {
  resolveMetric,
  resolveDimension,
  resolveFilterField,
  resolveDimensionOrFilter,
  type FilterFieldDef,
} from "../registry/registry.js";
import type { AnalyticsQueryBody, DrillThroughParams } from "./validators.js";
import {
  validateExpression,
  evaluateExpression,
  validateJoinCondition,
  JOIN_ROW_CAP,
  DRILL_THROUGH_ROW_CAP,
  type CalcExpression,
  CalcFieldError,
  JoinError,
  DrillThroughError,
} from "./domain.js";
import type { FilterSpec } from "../registry/spec.js";

interface QueryResult {
  rows: Array<Record<string, string | number | null>>;
  rowCount: number;
  metrics: string[];
  dimensions: string[];
  calculatedFields: string[];
}

interface DrillThroughResult {
  rows: Array<Record<string, string | number | null>>;
  rowCount: number;
  reportId: string;
  cellId: string;
}

/** Coerce filter value to field's type (defensive). */
function coerceValue(def: FilterFieldDef, value: unknown): string | number {
  if (def.type === "number") {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return 0;
    return n;
  }
  return String(value);
}

/** Build a WHERE condition from a filter spec. */
function buildCondition(f: FilterSpec): SQL {
  const def = resolveFilterField(f.field);
  const col = def.column;

  if (f.op === "in") {
    const arr = Array.isArray(f.value) ? f.value : [f.value];
    const values = arr.map((v) => coerceValue(def, v));
    if (values.length === 0) return sql`TRUE`;
    return inArray(col, values);
  }

  const v = coerceValue(def, f.value);
  switch (f.op) {
    case "eq": return eq(col, v);
    case "neq": return ne(col, v);
    case "gt": return gt(col, v);
    case "gte": return gte(col, v);
    case "lt": return lt(col, v);
    case "lte": return lte(col, v);
    default: return sql`TRUE`;
  }
}

/** Build aggregate SQL expression for a metric. */
function metricExpr(metricKey: string): SQL<number> {
  const m = resolveMetric(metricKey);
  switch (m.agg) {
    case "count": return sql<number>`count(*)::float8`;
    case "sum": return sql<number>`coalesce(sum(${m.column}), 0)::float8`;
    case "avg": return sql<number>`coalesce(avg(${m.column}), 0)::float8`;
    case "max": return sql<number>`coalesce(max(${m.column}), 0)::float8`;
    case "min": return sql<number>`coalesce(min(${m.column}), 0)::float8`;
  }
}

/**
 * Execute an analytics query with joins and calculated fields.
 * - Joins are self-joins on fact_events with different filter scopes
 * - Calculated fields are evaluated in-memory on result rows
 * - Row cap: 1000
 */
export async function executeAnalyticsQuery(
  tx: Db,
  tenantId: string,
  body: AnalyticsQueryBody,
): Promise<QueryResult> {
  // Validate joins
  for (const join of body.joins) {
    validateJoinCondition(join);
  }

  // Validate calculated field expressions
  for (const cf of body.calculatedFields) {
    validateExpression(cf.expression as CalcExpression);
  }

  // Build selection: dimensions + metrics
  const dims = body.dimensions.map(resolveDimension);
  const selection: Record<string, unknown> = {};
  for (const d of dims) {
    selection[d.key] = d.column;
  }
  for (const metricKey of body.metrics) {
    selection[metricKey] = metricExpr(metricKey);
  }

  // WHERE conditions: tenant predicate ALWAYS first
  const conds: SQL[] = [eq(factEvents.tenantId, tenantId)];
  for (const f of body.filters) {
    conds.push(buildCondition(f as FilterSpec));
  }
  if (body.dateFrom) conds.push(gte(factEvents.occurredAt, new Date(body.dateFrom)));
  if (body.dateTo) conds.push(lte(factEvents.occurredAt, new Date(body.dateTo)));

  // For joins: we self-join fact_events using join condition keys as correlation
  // The join effectively filters correlated rows within the same tenant scope
  if (body.joins.length > 0) {
    // Use a subquery-based approach: main query with join correlation
    // In analytics, joins are between the same fact table with different grouping
    // This translates to additional WHERE conditions correlating dimensions
    for (const join of body.joins) {
      // The join means: leftKey column values must match rightKey column values
      // Since both reference the same table, this is a self-correlation filter.
      // resolveDimensionOrFilter() always returns a real whitelisted column or
      // throws — it never yields `undefined` (validateJoinCondition() above
      // already confirmed both keys are whitelisted, so this cannot throw here,
      // but we don't rely on that: unlike the old
      // `resolveDimension(x) ?? resolveFilterField(x)` pattern, there is no
      // path left that can push an undefined "column" into the SQL below).
      const leftDef = resolveDimensionOrFilter(join.leftKey);
      const rightDef = resolveDimensionOrFilter(join.rightKey);
      conds.push(sql`${leftDef.column} = ${rightDef.column}`);
    }
  }

  // Cap at JOIN_ROW_CAP
  const limit = Math.min(body.limit, JOIN_ROW_CAP);

  // Build and execute query
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = tx.select(selection as any).from(factEvents).where(and(...conds));
  if (dims.length > 0) {
    q = q.groupBy(...dims.map((d) => d.column));
  }
  q = q.limit(limit);

  const rawRows = (await q) as Array<Record<string, unknown>>;

  // Normalise rows and apply calculated fields
  const rows: Array<Record<string, string | number | null>> = rawRows.map((r) => {
    const out: Record<string, string | number | null> = {};
    // Add dimension values
    for (const d of body.dimensions) {
      out[d] = r[d] == null ? null : String(r[d]);
    }
    // Add metric values
    for (const metricKey of body.metrics) {
      out[metricKey] = typeof r[metricKey] === "number" ? r[metricKey] as number : Number(r[metricKey] ?? 0);
    }
    // Evaluate calculated fields
    for (const cf of body.calculatedFields) {
      const val = evaluateExpression(cf.expression as CalcExpression, out as Record<string, unknown>);
      out[cf.alias] = Number.isFinite(val) ? val : null;
    }
    return out;
  });

  return {
    rows,
    rowCount: rows.length,
    metrics: body.metrics,
    dimensions: body.dimensions,
    calculatedFields: body.calculatedFields.map((cf) => cf.alias),
  };
}

/**
 * Execute drill-through: navigate from an aggregated cell to the detail rows.
 * - Looks up the stored query run by reportId
 * - Applies the cell's dimension filters to get detail rows
 * - Caps at 200 rows
 * - Always tenant-scoped
 */
export async function executeDrillThrough(
  tx: Db,
  tenantId: string,
  reportId: string,
  cellId: string,
  limit: number,
  offset: number,
): Promise<DrillThroughResult> {
  // Look up the query run (report) by ID — must belong to this tenant
  const runs = await tx
    .select()
    .from(queryRuns)
    .where(and(eq(queryRuns.id, reportId), eq(queryRuns.tenantId, tenantId)))
    .limit(1);

  const run = runs[0];
  if (!run) {
    throw new DrillThroughError("REPORT_NOT_FOUND", "query run not found");
  }
  if (run.status !== "completed") {
    throw new DrillThroughError("REPORT_NOT_READY", "query run is not completed");
  }

  // Parse cellId: format is "dim1=val1;dim2=val2" (dimension filters for the cell)
  const cellFilters = parseCellId(cellId);

  // Build detail query: select all visible columns, filtered by cell dimensions
  const conds: SQL[] = [eq(factEvents.tenantId, tenantId)];

  for (const [key, value] of cellFilters) {
    const def = resolveFilterField(key);
    conds.push(eq(def.column, value));
  }

  // Also apply any date filters from the original spec
  const spec = run.spec as Record<string, unknown> | null;
  if (spec) {
    if (spec.dateFrom && typeof spec.dateFrom === "string") {
      conds.push(gte(factEvents.occurredAt, new Date(spec.dateFrom)));
    }
    if (spec.dateTo && typeof spec.dateTo === "string") {
      conds.push(lte(factEvents.occurredAt, new Date(spec.dateTo)));
    }
  }

  // Cap at DRILL_THROUGH_ROW_CAP
  const cappedLimit = Math.min(limit, DRILL_THROUGH_ROW_CAP);

  const rawRows = await tx
    .select({
      id: factEvents.id,
      source: factEvents.source,
      eventType: factEvents.eventType,
      category: factEvents.category,
      status: factEvents.status,
      amount: factEvents.amount,
      occurredAt: factEvents.occurredAt,
    })
    .from(factEvents)
    .where(and(...conds))
    .limit(cappedLimit)
    .offset(offset);

  const rows: Array<Record<string, string | number | null>> = rawRows.map((r) => ({
    id: r.id,
    source: r.source,
    eventType: r.eventType,
    category: r.category,
    status: r.status,
    amount: Number(r.amount),
    occurredAt: r.occurredAt.toISOString(),
  }));

  return {
    rows,
    rowCount: rows.length,
    reportId,
    cellId,
  };
}

/**
 * Parse a cellId into dimension key-value pairs.
 * Format: "key1=value1,key2=value2" (comma-separated)
 * Example: "source=finance,status=completed"
 */
function parseCellId(cellId: string): Array<[string, string]> {
  if (!cellId || cellId.trim().length === 0) return [];

  return cellId.split(",").map((part) => {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) {
      throw new DrillThroughError("INVALID_CELL_ID", `invalid cell filter format: ${part}`);
    }
    const key = part.slice(0, eqIdx).trim();
    const value = part.slice(eqIdx + 1).trim();
    if (!key || !value) {
      throw new DrillThroughError("INVALID_CELL_ID", `empty key or value in cell filter: ${part}`);
    }
    return [key, value];
  });
}
