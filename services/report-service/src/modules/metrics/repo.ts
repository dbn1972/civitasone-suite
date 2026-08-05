/**
 * metrics repo — Drizzle access to reports.metric_definitions.
 *
 * Reads go through readScoped() so PostgreSQL RLS is enforced (the report_svc
 * role is NOBYPASSRLS). Every filter is a bound Drizzle parameter: no value from
 * the request — least of all numeratorSource/denominatorSource — is ever
 * concatenated into SQL.
 */
import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { db, readScoped } from "../../shared/db.js";
import { PLATFORM_TENANT_ID } from "./domain.js";
import {
  metricDefinitions,
  type MetricDefinitionInsert,
  type MetricDefinitionRow,
  type MetricDefinitionView,
} from "./schema.js";

export interface MetricFilters {
  module?: string;
  status?: string;
  governance?: string;
  metricKey?: string;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export function toView(row: MetricDefinitionRow): MetricDefinitionView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    metricKey: row.metricKey,
    displayName: row.displayName,
    description: row.description,
    module: row.module,
    unit: row.unit,
    aggregation: row.aggregation,
    numeratorSource: row.numeratorSource,
    denominatorSource: row.denominatorSource,
    dimensions: (row.dimensions ?? []) as string[],
    targetValue: row.targetValue === null ? null : String(row.targetValue),
    period: row.period,
    higherIsBetter: row.higherIsBetter,
    governance: row.governance,
    versionNumber: row.versionNumber,
    status: row.status,
    publishedAt: iso(row.publishedAt),
    deprecatedAt: iso(row.deprecatedAt),
    createdAt: iso(row.createdAt) ?? "",
    updatedAt: iso(row.updatedAt) ?? "",
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    version: row.version,
  };
}

/**
 * A tenant sees its own definitions plus the platform-standard canonical ones.
 * Mirrors the RLS policy's read carve-out for the platform tenant.
 */
function visibleTo(tenantId: string) {
  return or(
    eq(metricDefinitions.tenantId, tenantId),
    eq(metricDefinitions.tenantId, PLATFORM_TENANT_ID),
  );
}

function filterClauses(tenantId: string, filters: MetricFilters) {
  const clauses = [visibleTo(tenantId)];
  if (filters.module !== undefined) clauses.push(eq(metricDefinitions.module, filters.module));
  if (filters.status !== undefined) clauses.push(eq(metricDefinitions.status, filters.status));
  if (filters.governance !== undefined) {
    clauses.push(eq(metricDefinitions.governance, filters.governance));
  }
  if (filters.metricKey !== undefined) {
    clauses.push(eq(metricDefinitions.metricKey, filters.metricKey));
  }
  return and(...clauses);
}

export async function findById(id: string, tenantId: string): Promise<MetricDefinitionView | null> {
  const rows = await readScoped(tenantId, (tx) =>
    tx
      .select()
      .from(metricDefinitions)
      .where(and(eq(metricDefinitions.id, id), visibleTo(tenantId)))
      .limit(1),
  );
  const row = rows[0];
  return row ? toView(row) : null;
}

/**
 * Resolve the currently published version of a metric key. A tenant's own
 * published definition wins over the platform canonical one; among equals the
 * highest versionNumber wins.
 */
export async function findPublishedByKey(
  metricKey: string,
  tenantId: string,
): Promise<MetricDefinitionView | null> {
  const rows = await readScoped(tenantId, (tx) =>
    tx
      .select()
      .from(metricDefinitions)
      .where(
        and(
          eq(metricDefinitions.metricKey, metricKey),
          eq(metricDefinitions.status, "published"),
          visibleTo(tenantId),
        ),
      )
      .orderBy(
        sql`case when ${metricDefinitions.tenantId} = ${tenantId}::uuid then 0 else 1 end`,
        desc(metricDefinitions.versionNumber),
      )
      .limit(1),
  );
  const row = rows[0];
  return row ? toView(row) : null;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: MetricFilters = {},
): Promise<{ rows: MetricDefinitionView[]; total: number }> {
  const where = filterClauses(tenantId, filters);
  const [rows, counted] = await readScoped(tenantId, async (tx) => {
    const page = await tx
      .select()
      .from(metricDefinitions)
      .where(where)
      .orderBy(asc(metricDefinitions.metricKey), desc(metricDefinitions.versionNumber))
      .limit(limit)
      .offset(offset);
    const total = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(metricDefinitions)
      .where(where);
    return [page, total] as const;
  });
  return { rows: rows.map(toView), total: counted[0]?.count ?? 0 };
}

/** Highest versionNumber already used for a key within a tenant (0 when unused). */
export async function maxVersionNumber(metricKey: string, tenantId: string): Promise<number> {
  const rows = await readScoped(tenantId, (tx) =>
    tx
      .select({ max: sql<number | null>`max(${metricDefinitions.versionNumber})::int` })
      .from(metricDefinitions)
      .where(
        and(eq(metricDefinitions.metricKey, metricKey), eq(metricDefinitions.tenantId, tenantId)),
      ),
  );
  return rows[0]?.max ?? 0;
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: MetricDefinitionInsert): Promise<void> {
  await tx.insert(metricDefinitions).values(row);
}

/**
 * Optimistic-locked update. Returns false when the version moved on (or the row
 * is not writable by this tenant), so the consumer can treat it as a no-op.
 */
export async function updateByVersion(
  tx: Writer,
  id: string,
  tenantId: string,
  currentVersion: number,
  data: Partial<Omit<MetricDefinitionInsert, "id" | "tenantId" | "createdAt" | "createdBy">>,
): Promise<boolean> {
  const result = await tx
    .update(metricDefinitions)
    .set({ ...data, version: currentVersion + 1, updatedAt: new Date() })
    .where(
      and(
        eq(metricDefinitions.id, id),
        eq(metricDefinitions.tenantId, tenantId),
        eq(metricDefinitions.version, currentVersion),
      ),
    );
  return (result as unknown as { rowCount: number }).rowCount > 0;
}
