/**
 * CAP-059 — reconciliation repository. Writes run inside db.transaction (GUC set
 * by the request tenant hook); reads use scopedRead so RLS is enforced.
 */
import { and, eq, desc, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { reconRun, reconBreak } from "./schema.js";
import type { ReconRunRow, ReconRunInsert, ReconBreakRow, ReconBreakInsert } from "./schema.js";

type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertRun(tx: Writer, row: ReconRunInsert): Promise<ReconRunRow> {
  const rows = (await (tx as typeof db).insert(reconRun).values(row).returning()) as ReconRunRow[];
  return rows[0]!;
}

export async function insertBreaks(tx: Writer, rows: ReconBreakInsert[]): Promise<void> {
  if (rows.length === 0) return;
  // Idempotent replay: the partial unique index (migration 0050) permits at most
  // one ACTIVE (open/investigating) break per (tenant, provider, break_key,
  // break_type, field). Re-running recon while the same mismatch persists hits
  // the conflict and is skipped instead of piling up duplicate open breaks.
  await (tx as typeof db)
    .insert(reconBreak)
    .values(rows)
    .onConflictDoNothing({
      target: [reconBreak.tenantId, reconBreak.provider, reconBreak.breakKey, reconBreak.breakType, reconBreak.field],
      where: sql`${reconBreak.status} IN ('open','investigating')`,
    });
}

export async function listRuns(tenantId: string, limit = 50): Promise<ReconRunRow[]> {
  return scopedRead((tx) =>
    tx.select().from(reconRun).where(eq(reconRun.tenantId, tenantId)).orderBy(desc(reconRun.createdAt)).limit(limit),
  );
}

export async function getRun(tenantId: string, id: string): Promise<ReconRunRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(reconRun).where(and(eq(reconRun.tenantId, tenantId), eq(reconRun.id, id))).limit(1),
  );
  return rows[0] ?? null;
}

export interface BreakFilter {
  status?: string | undefined;
  runId?: string | undefined;
}

export async function listBreaks(tenantId: string, filter: BreakFilter = {}, limit = 200): Promise<ReconBreakRow[]> {
  const preds = [eq(reconBreak.tenantId, tenantId)];
  if (filter.status) preds.push(eq(reconBreak.status, filter.status));
  if (filter.runId) preds.push(eq(reconBreak.runId, filter.runId));
  return scopedRead((tx) =>
    tx.select().from(reconBreak).where(and(...preds)).orderBy(desc(reconBreak.createdAt)).limit(limit),
  );
}

export async function getBreak(tenantId: string, id: string): Promise<ReconBreakRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(reconBreak).where(and(eq(reconBreak.tenantId, tenantId), eq(reconBreak.id, id))).limit(1),
  );
  return rows[0] ?? null;
}

/**
 * Tx-scoped variant of getBreak: reads through the caller's already-open
 * transaction. finance.recon.exception_action calls this from inside its own
 * db.transaction(); the scopedRead-based getBreak would open a second, nested
 * transaction competing for an extra pool connection while the outer one is
 * already held — under load (pool.max concurrent in-flight commands) that is
 * a total, silent deadlock (every in-flight transaction blocks forever
 * waiting on a connection the others are holding hostage).
 */
export async function getBreakTx(tx: Writer, tenantId: string, id: string): Promise<ReconBreakRow | null> {
  const rows = await (tx as typeof db).select().from(reconBreak)
    .where(and(eq(reconBreak.tenantId, tenantId), eq(reconBreak.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function updateBreakStatus(
  tx: Writer,
  tenantId: string,
  id: string,
  patch: { status: string; resolutionNote?: string | null; resolvedBy?: string | null; resolvedAt?: Date | null },
): Promise<ReconBreakRow | undefined> {
  const set: Record<string, unknown> = { status: patch.status, updatedAt: new Date() };
  if (patch.resolutionNote !== undefined) set.resolutionNote = patch.resolutionNote;
  if (patch.resolvedBy !== undefined) set.resolvedBy = patch.resolvedBy;
  if (patch.resolvedAt !== undefined) set.resolvedAt = patch.resolvedAt;
  const rows = (await (tx as typeof db)
    .update(reconBreak)
    .set(set)
    .where(and(eq(reconBreak.tenantId, tenantId), eq(reconBreak.id, id)))
    .returning()) as ReconBreakRow[];
  return rows[0];
}
