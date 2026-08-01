/**
 * governance/repo.ts — Database operations for the AI governance audit trail.
 *
 * DPDP Act 2023: callers MUST pass entries produced by
 * governance/domain.ts#buildAuditEntry so the persisted input/output are
 * PII-redacted and truncated. Raw personal data never reaches this table.
 */
import { eq, and, sql, desc, type SQL } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { aiAuditLog, type AiAuditLogRow, type AiAuditLogInsert } from "./schema.js";

export function toView(r: AiAuditLogRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    agentId: r.agentId,
    action: r.action,
    input: r.input,
    output: r.output,
    blocked: r.blocked,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
    version: r.version,
  };
}

export type AuditView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<AiAuditLogRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(aiAuditLog)
      .where(and(eq(aiAuditLog.id, id), eq(aiAuditLog.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export interface ListFilters {
  agentId?: string;
  blocked?: boolean;
  action?: string;
}

function buildWhere(tenantId: string, filters: ListFilters): SQL | undefined {
  const conditions: SQL[] = [eq(aiAuditLog.tenantId, tenantId)];
  if (filters.agentId) conditions.push(eq(aiAuditLog.agentId, filters.agentId));
  if (filters.blocked !== undefined) conditions.push(eq(aiAuditLog.blocked, filters.blocked));
  if (filters.action) conditions.push(eq(aiAuditLog.action, filters.action));
  return and(...conditions);
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
): Promise<{ rows: AiAuditLogRow[]; total: number }> {
  const where = buildWhere(tenantId, filters);

  const rows = await scopedRead((tx) =>
    tx.select().from(aiAuditLog)
      .where(where)
      .orderBy(desc(aiAuditLog.createdAt))
      .limit(limit)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(aiAuditLog).where(where),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

/** Aggregate counts for block-rate reporting. */
export async function countTotals(
  tenantId: string,
  filters: ListFilters = {},
): Promise<{ total: number; blocked: number }> {
  const where = buildWhere(tenantId, filters);

  const result = await scopedRead((tx) =>
    tx.select({
      total: sql<number>`count(*)::int`,
      blocked: sql<number>`count(*) filter (where ${aiAuditLog.blocked})::int`,
    }).from(aiAuditLog).where(where),
  );

  return { total: result[0]?.total ?? 0, blocked: result[0]?.blocked ?? 0 };
}

/**
 * Blocked-interaction count per agent — the "error count" column of the AG-002
 * ops console. Aggregated in Postgres because the audit log is the largest table
 * in the service and must never be pulled into Node to be counted.
 */
export async function blockedCountsByAgent(tenantId: string): Promise<Record<string, number>> {
  const rows = await scopedRead((tx) =>
    tx.select({ agentId: aiAuditLog.agentId, count: sql<number>`count(*)::int` })
      .from(aiAuditLog)
      .where(and(eq(aiAuditLog.tenantId, tenantId), eq(aiAuditLog.blocked, true)))
      .groupBy(aiAuditLog.agentId),
  );
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.agentId !== null) out[r.agentId] = r.count;
  }
  return out;
}

export async function insert(tx: ScopedTx, row: AiAuditLogInsert): Promise<void> {
  await tx.insert(aiAuditLog).values(row);
}
