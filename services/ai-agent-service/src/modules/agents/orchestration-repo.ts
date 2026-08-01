/**
 * agents/orchestration-repo.ts — DB operations for AG-001 orchestrations and
 * their hop trace, plus the aggregate counters the AG-002 ops console reads.
 * Every query is tenant-filtered; writes take a ScopedTx, reads go via scopedRead.
 */
import { eq, and, sql, desc, asc, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import {
  orchestrations,
  orchestrationHops,
  type OrchestrationRow,
  type OrchestrationInsert,
  type OrchestrationHopRow,
  type OrchestrationHopInsert,
} from "./orchestration-schema.js";

export function toView(r: OrchestrationRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    rootAgentId: r.rootAgentId,
    status: r.status,
    depth: r.depth,
    maxDepth: r.maxDepth,
    hopCount: r.hopCount,
    maxHops: r.maxHops,
    reason: r.reason,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export type OrchestrationView = ReturnType<typeof toView>;

export function toHopView(r: OrchestrationHopRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    orchestrationId: r.orchestrationId,
    fromAgentId: r.fromAgentId,
    toAgentId: r.toAgentId,
    depth: r.depth,
    reason: r.reason,
    occurredAt: r.occurredAt.toISOString(),
    version: r.version,
  };
}

export type HopView = ReturnType<typeof toHopView>;

export async function findById(id: string, tenantId: string): Promise<OrchestrationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(orchestrations)
      .where(and(eq(orchestrations.id, id), eq(orchestrations.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export interface ListFilters {
  status?: string;
  rootAgentId?: string;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
): Promise<{ rows: OrchestrationRow[]; total: number }> {
  const conditions: SQL[] = [eq(orchestrations.tenantId, tenantId)];
  if (filters.status) conditions.push(eq(orchestrations.status, filters.status));
  if (filters.rootAgentId) conditions.push(eq(orchestrations.rootAgentId, filters.rootAgentId));
  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx.select().from(orchestrations)
      .where(where)
      .orderBy(desc(orchestrations.startedAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(orchestrations).where(where),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

/** Full hop trace for one orchestration, oldest first (chronological evidence order). */
export async function listHops(
  orchestrationId: string,
  tenantId: string,
): Promise<OrchestrationHopRow[]> {
  return scopedRead((tx) =>
    tx.select().from(orchestrationHops)
      .where(and(
        eq(orchestrationHops.tenantId, tenantId),
        eq(orchestrationHops.orchestrationId, orchestrationId),
      ))
      .orderBy(asc(orchestrationHops.occurredAt)),
  );
}

export async function insert(tx: ScopedTx, row: OrchestrationInsert): Promise<void> {
  await tx.insert(orchestrations).values(row);
}

export async function insertHop(tx: ScopedTx, row: OrchestrationHopInsert): Promise<void> {
  await tx.insert(orchestrationHops).values(row);
}

export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<OrchestrationInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(orchestrations)
    .set({ ...patch, updatedAt: new Date(), version: sql`${orchestrations.version} + 1` })
    .where(and(
      eq(orchestrations.id, id),
      eq(orchestrations.tenantId, tenantId),
      eq(orchestrations.version, currentVersion),
    ))
    .returning({ id: orchestrations.id });
  return result.length > 0;
}

/** Live orchestration counts per status, used by the ops console summary. */
export async function countsByStatus(tenantId: string): Promise<Record<string, number>> {
  const rows = await scopedRead((tx) =>
    tx.select({ status: orchestrations.status, count: sql<number>`count(*)::int` })
      .from(orchestrations)
      .where(eq(orchestrations.tenantId, tenantId))
      .groupBy(orchestrations.status),
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r.count;
  return out;
}

export interface DurationStats {
  avgHopCount: number;
  p95DurationMs: number;
}

/**
 * Average hop count and p95 wall-clock duration of finished orchestrations.
 * percentile_cont is computed in Postgres — pulling every row into Node to
 * sort it would not scale past a few thousand orchestrations.
 */
export async function durationStats(tenantId: string): Promise<DurationStats> {
  const rows = await scopedRead((tx) =>
    tx.select({
      avgHopCount: sql<string | null>`avg(${orchestrations.hopCount})`,
      p95DurationMs: sql<string | null>`percentile_cont(0.95) within group (
        order by extract(epoch from (coalesce(${orchestrations.completedAt}, now()) - ${orchestrations.startedAt})) * 1000
      )`,
    }).from(orchestrations).where(eq(orchestrations.tenantId, tenantId)),
  );
  const row = rows[0];
  return {
    avgHopCount: Number(row?.avgHopCount ?? 0),
    p95DurationMs: Number(row?.p95DurationMs ?? 0),
  };
}

/** Active (running) orchestration count per root agent — ops console live status. */
export async function activeCountsByAgent(tenantId: string): Promise<Record<string, number>> {
  const rows = await scopedRead((tx) =>
    tx.select({ rootAgentId: orchestrations.rootAgentId, count: sql<number>`count(*)::int` })
      .from(orchestrations)
      .where(and(eq(orchestrations.tenantId, tenantId), eq(orchestrations.status, "running")))
      .groupBy(orchestrations.rootAgentId),
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.rootAgentId] = r.count;
  return out;
}

/** Failed orchestration count per root agent — ops console error column. */
export async function failedCountsByAgent(tenantId: string): Promise<Record<string, number>> {
  const rows = await scopedRead((tx) =>
    tx.select({ rootAgentId: orchestrations.rootAgentId, count: sql<number>`count(*)::int` })
      .from(orchestrations)
      .where(and(eq(orchestrations.tenantId, tenantId), eq(orchestrations.status, "failed")))
      .groupBy(orchestrations.rootAgentId),
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.rootAgentId] = r.count;
  return out;
}
