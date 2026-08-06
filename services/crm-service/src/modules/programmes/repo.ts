/**
 * Programme reads and guarded writes (G12).
 *
 * Every read goes through `scopedRead`, which wraps it in a tenant transaction so the
 * FORCE-RLS policy on crm.programmes / crm.programme_metrics is actually evaluated. A
 * bare `db.select()` on a pooled connection has no `app.tenant_id` GUC and silently
 * returns zero rows, which reads as "not found" rather than as the bug it is.
 *
 * The write helpers all return whether they matched a row. That is what lets the consumer
 * tell "applied" from "dropped because the state moved" and leave an audit record either
 * way instead of failing silently.
 */
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  programmeMetrics,
  programmes,
  type CoverageScope,
  type ProgrammeMetricRow,
  type ProgrammeMetricView,
  type ProgrammeRow,
  type ProgrammeView,
} from "./schema.js";
import type { MetricSample } from "./domain.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export function toView(r: ProgrammeRow): ProgrammeView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    programmeCode: r.programmeCode,
    name: r.name,
    description: r.description,
    accountId: r.accountId,
    contractId: r.contractId,
    productLine: r.productLine,
    status: r.status,
    startDate: r.startDate ?? null,
    endDate: r.endDate ?? null,
    sponsoringDepartment: r.sponsoringDepartment,
    coverageScope: r.coverageScope ?? {},
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export function toMetricView(r: ProgrammeMetricRow): ProgrammeMetricView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    programmeId: r.programmeId,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    metricKey: r.metricKey,
    metricKind: r.metricKind,
    // Money crosses the wire as a string — see the module README.
    valueMinor: r.valueMinor === null ? null : r.valueMinor.toString(),
    currency: r.currency,
    valueNumeric: r.valueNumeric,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<ProgrammeView | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(programmes)
      .where(and(eq(programmes.id, id), eq(programmes.tenantId, tenantId)))
      .limit(1),
  );
  const row = rows[0];
  return row ? toView(row) : null;
}

export async function findByCode(code: string, tenantId: string): Promise<ProgrammeView | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(programmes)
      .where(and(eq(programmes.programmeCode, code), eq(programmes.tenantId, tenantId)))
      .limit(1),
  );
  const row = rows[0];
  return row ? toView(row) : null;
}

export interface ListFilters {
  status?: string;
  accountId?: string;
  productLine?: string;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
): Promise<{ rows: ProgrammeView[]; total: number }> {
  const where = and(
    eq(programmes.tenantId, tenantId),
    ...(filters.status ? [eq(programmes.status, filters.status)] : []),
    ...(filters.accountId ? [eq(programmes.accountId, filters.accountId)] : []),
    ...(filters.productLine ? [eq(programmes.productLine, filters.productLine)] : []),
  );
  return scopedRead(async (tx) => {
    const rows = await tx
      .select()
      .from(programmes)
      .where(where)
      .orderBy(desc(programmes.updatedAt))
      .limit(limit)
      .offset(offset);
    const counted = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(programmes)
      .where(where);
    return { rows: rows.map(toView), total: counted[0]?.total ?? 0 };
  });
}

export interface MetricFilters {
  metricKey?: string;
  periodStartFrom?: string;
  periodStartTo?: string;
}

function metricWhere(tenantId: string, programmeId: string, filters: MetricFilters) {
  return and(
    eq(programmeMetrics.tenantId, tenantId),
    eq(programmeMetrics.programmeId, programmeId),
    ...(filters.metricKey ? [eq(programmeMetrics.metricKey, filters.metricKey)] : []),
    ...(filters.periodStartFrom ? [gte(programmeMetrics.periodStart, filters.periodStartFrom)] : []),
    ...(filters.periodStartTo ? [lte(programmeMetrics.periodStart, filters.periodStartTo)] : []),
  );
}

export async function listMetrics(
  tenantId: string,
  programmeId: string,
  limit: number,
  offset: number,
  filters: MetricFilters = {},
): Promise<{ rows: ProgrammeMetricView[]; total: number }> {
  const where = metricWhere(tenantId, programmeId, filters);
  return scopedRead(async (tx) => {
    const rows = await tx
      .select()
      .from(programmeMetrics)
      .where(where)
      .orderBy(desc(programmeMetrics.periodStart), asc(programmeMetrics.metricKey))
      .limit(limit)
      .offset(offset);
    const counted = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(programmeMetrics)
      .where(where);
    return { rows: rows.map(toMetricView), total: counted[0]?.total ?? 0 };
  });
}

/**
 * Every metric sample for a programme, for the health roll-up. Unbounded by design and
 * safe: the UNIQUE (tenant, programme, period_start, metric_key) index caps the row count
 * at metrics × periods for ONE programme, which is reporting-sized, not table-sized.
 */
export async function metricSamples(
  tenantId: string,
  programmeId: string,
  filters: MetricFilters = {},
): Promise<MetricSample[]> {
  const rows = await scopedRead((tx) =>
    tx
      .select({
        metricKey: programmeMetrics.metricKey,
        metricKind: programmeMetrics.metricKind,
        valueMinor: programmeMetrics.valueMinor,
        valueNumeric: programmeMetrics.valueNumeric,
      })
      .from(programmeMetrics)
      .where(metricWhere(tenantId, programmeId, filters)),
  );
  return rows.map((r) => ({
    metricKey: r.metricKey,
    metricKind: r.metricKind,
    valueMinor: r.valueMinor === null ? null : r.valueMinor.toString(),
    valueNumeric: r.valueNumeric,
  }));
}

// ── Writes (consumer-only) ──────────────────────────────────────────────────────────

export interface InsertProgramme {
  id: string;
  tenantId: string;
  programmeCode: string;
  name: string;
  description: string | null;
  accountId: string;
  contractId: string | null;
  productLine: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  sponsoringDepartment: string | null;
  coverageScope: CoverageScope;
  actorId: string;
}

/**
 * ON CONFLICT DO NOTHING against uq_programmes_code: a retried create (same idempotency
 * key, different messageId, or two operators registering the same programme) must converge
 * on one row rather than fail the consumer and be redelivered forever.
 */
export async function insertProgramme(tx: Writer, row: InsertProgramme): Promise<boolean> {
  const inserted = await (tx as typeof db)
    .insert(programmes)
    .values({
      id: row.id,
      tenantId: row.tenantId,
      programmeCode: row.programmeCode,
      name: row.name,
      description: row.description,
      accountId: row.accountId,
      contractId: row.contractId,
      productLine: row.productLine,
      status: row.status,
      startDate: row.startDate,
      endDate: row.endDate,
      sponsoringDepartment: row.sponsoringDepartment,
      coverageScope: row.coverageScope,
      createdBy: row.actorId,
      updatedBy: row.actorId,
      version: 1,
    })
    .onConflictDoNothing({ target: [programmes.tenantId, programmes.programmeCode] })
    .returning({ id: programmes.id });
  return inserted.length > 0;
}

export interface ProgrammePatch {
  name?: string;
  description?: string | null;
  contractId?: string | null;
  productLine?: string;
  startDate?: string | null;
  endDate?: string | null;
  sponsoringDepartment?: string | null;
  coverageScope?: CoverageScope;
}

/** Optimistic lock: matches nothing when the row has moved on, and says so. */
export async function updateWithVersion(
  tx: Writer,
  id: string,
  tenantId: string,
  expectedVersion: number,
  patch: ProgrammePatch,
  actorId: string,
): Promise<boolean> {
  const set: Record<string, unknown> = {
    updatedAt: new Date(),
    updatedBy: actorId,
    version: sql`${programmes.version} + 1`,
  };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.contractId !== undefined) set.contractId = patch.contractId;
  if (patch.productLine !== undefined) set.productLine = patch.productLine;
  if (patch.startDate !== undefined) set.startDate = patch.startDate;
  if (patch.endDate !== undefined) set.endDate = patch.endDate;
  if (patch.sponsoringDepartment !== undefined) set.sponsoringDepartment = patch.sponsoringDepartment;
  if (patch.coverageScope !== undefined) set.coverageScope = patch.coverageScope;

  const updated = await (tx as typeof db)
    .update(programmes)
    .set(set)
    .where(
      and(
        eq(programmes.id, id),
        eq(programmes.tenantId, tenantId),
        eq(programmes.version, expectedVersion),
      ),
    )
    .returning({ id: programmes.id });
  return updated.length > 0;
}

/**
 * Status change guarded on BOTH version and the status the caller believed it was leaving,
 * so a legal-when-accepted transition cannot apply against a state that has since changed.
 */
export async function changeStatusWithVersion(
  tx: Writer,
  id: string,
  tenantId: string,
  fromStatus: string,
  toStatus: string,
  expectedVersion: number,
  actorId: string,
): Promise<boolean> {
  const updated = await (tx as typeof db)
    .update(programmes)
    .set({
      status: toStatus,
      updatedAt: new Date(),
      updatedBy: actorId,
      version: sql`${programmes.version} + 1`,
    })
    .where(
      and(
        eq(programmes.id, id),
        eq(programmes.tenantId, tenantId),
        eq(programmes.version, expectedVersion),
        eq(programmes.status, fromStatus),
      ),
    )
    .returning({ id: programmes.id });
  return updated.length > 0;
}

export interface UpsertMetric {
  id: string;
  tenantId: string;
  programmeId: string;
  periodStart: string;
  periodEnd: string;
  metricKey: string;
  metricKind: string;
  valueMinor: bigint | null;
  currency: string | null;
  valueNumeric: string | null;
  actorId: string;
}

/**
 * Idempotent metric write. The UNIQUE (tenant, programme, period_start, metric_key) index
 * turns a redelivered or corrected submission into an UPDATE of that period's single row,
 * so a requeued message cannot double a programme's reported revenue.
 *
 * Returns the row id actually holding the metric — which is NOT `row.id` when the period
 * already existed — so the event and audit record point at the real row.
 */
export async function upsertMetric(tx: Writer, row: UpsertMetric): Promise<{ id: string; created: boolean }> {
  const inserted = await (tx as typeof db)
    .insert(programmeMetrics)
    .values({
      id: row.id,
      tenantId: row.tenantId,
      programmeId: row.programmeId,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      metricKey: row.metricKey,
      metricKind: row.metricKind,
      valueMinor: row.valueMinor,
      currency: row.currency,
      valueNumeric: row.valueNumeric,
      createdBy: row.actorId,
      updatedBy: row.actorId,
      version: 1,
    })
    .onConflictDoUpdate({
      target: [
        programmeMetrics.tenantId,
        programmeMetrics.programmeId,
        programmeMetrics.periodStart,
        programmeMetrics.metricKey,
      ],
      set: {
        periodEnd: row.periodEnd,
        metricKind: row.metricKind,
        valueMinor: row.valueMinor,
        currency: row.currency,
        valueNumeric: row.valueNumeric,
        updatedAt: new Date(),
        updatedBy: row.actorId,
        version: sql`${programmeMetrics.version} + 1`,
      },
    })
    .returning({ id: programmeMetrics.id, version: programmeMetrics.version });
  const result = inserted[0];
  return { id: result?.id ?? row.id, created: (result?.version ?? 1) === 1 };
}

/**
 * Link a deal to a programme. Touches ONLY programme_id (plus the standard audit columns)
 * — every other deal field is left exactly as the deals module left it. Guarded on the
 * deal's version so two concurrent links cannot both win.
 */
export async function linkDeal(
  tx: Writer,
  dealId: string,
  tenantId: string,
  programmeId: string,
  expectedVersion: number,
  actorId: string,
): Promise<boolean> {
  const rows = (await (tx as unknown as { execute: (q: unknown) => Promise<unknown> }).execute(sql`
    UPDATE crm.deals
    SET programme_id = ${programmeId},
        updated_at = now(),
        updated_by = ${actorId},
        version = version + 1
    WHERE id = ${dealId}
      AND tenant_id = ${tenantId}
      AND version = ${expectedVersion}
      AND status NOT IN ('deleted', 'cancelled')
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  return rows.length > 0;
}

/** Version + linkage snapshot for a deal, so the route can pre-check what the consumer guards. */
export interface DealLinkSnapshot {
  id: string;
  version: number;
  programmeId: string | null;
  status: string;
}

export async function dealLinkSnapshot(
  tenantId: string,
  dealId: string,
): Promise<DealLinkSnapshot | null> {
  const rows = (await scopedRead(async (tx) =>
    tx.execute(sql`
      SELECT id, version, programme_id AS "programmeId", status
      FROM crm.deals
      WHERE id = ${dealId}
        AND tenant_id = ${tenantId}
        AND status NOT IN ('deleted', 'cancelled')
      LIMIT 1
    `),
  )) as unknown as DealLinkSnapshot[];
  return rows[0] ?? null;
}
