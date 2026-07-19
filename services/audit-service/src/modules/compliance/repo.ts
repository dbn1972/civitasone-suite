import { and, eq, desc, sql, lt, inArray } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { auditPendingRegister, auditChecklists, type PendingRegisterRow, type ChecklistRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * P2-4 / M3: ageing sweep — flip up to `limit` 'pending' register items whose due_date
 * is strictly in the past to 'overdue'. Runs inside the caller's transaction (Writer = tx)
 * so the status flip and its audit events are committed atomically. The LIMIT bounds each
 * transaction; the caller loops until a batch comes back empty. Cross-tenant (system tick),
 * bumps version + updated_at. Returns the rows that transitioned in this batch.
 */
/**
 * Cross-tenant candidate scan for the ageing sweep. MUST be called via
 * scopedPlatformRead (see shared/db.ts) — a bare/strict-tenant transaction
 * finds nothing across tenants since current_tenant_id() is NULL with no
 * per-request GUC set. Returns only distinct tenant ids, not rows: the
 * actual SELECT FOR UPDATE + UPDATE for each tenant happens under that
 * tenant's own strict-RLS GUC in sweepOverdueBatchForTenant below, since
 * there is no bypass policy for UPDATE (writes always stay tenant-scoped).
 */
export async function findOverdueTenantIds(tx: Writer, now: Date): Promise<string[]> {
  const rows = await (tx as typeof db)
    .select({ tenantId: auditPendingRegister.tenantId })
    .from(auditPendingRegister)
    .where(and(
      eq(auditPendingRegister.status, "pending"),
      sql`${auditPendingRegister.dueDate} IS NOT NULL`,
      lt(auditPendingRegister.dueDate, now.toISOString().slice(0, 10)),
    ))
    .groupBy(auditPendingRegister.tenantId);
  return rows.map((r) => r.tenantId);
}

/**
 * Flip one tenant's overdue pending-register rows to 'overdue'. Called
 * inside runWithTenant(tenantId, () => db.transaction(...)) so the strict
 * tenant-match RLS policy (the ONLY policy governing UPDATE on this table)
 * is satisfied.
 */
export async function sweepOverdueBatch(tx: Writer, now: Date, limit: number): Promise<{ id: string; tenantId: string }[]> {
  // FOR UPDATE SKIP LOCKED on the candidate set so concurrent ticks don't deadlock/double-flip.
  const candidates = await (tx as typeof db).select({ id: auditPendingRegister.id }).from(auditPendingRegister)
    .where(and(
      eq(auditPendingRegister.status, "pending"),
      sql`${auditPendingRegister.dueDate} IS NOT NULL`,
      lt(auditPendingRegister.dueDate, now.toISOString().slice(0, 10)),
    ))
    .limit(limit)
    .for("update", { skipLocked: true });
  if (candidates.length === 0) return [];
  const ids = candidates.map((c) => c.id);
  const res = await (tx as typeof db).update(auditPendingRegister)
    .set({ status: "overdue", updatedAt: new Date(), version: sql`${auditPendingRegister.version} + 1` })
    .where(and(
      eq(auditPendingRegister.status, "pending"),
      inArray(auditPendingRegister.id, ids),
    ))
    .returning({ id: auditPendingRegister.id, tenantId: auditPendingRegister.tenantId });
  return res;
}

export async function insertPendingRegister(tx: Writer, row: typeof auditPendingRegister.$inferInsert): Promise<void> {
  await tx.insert(auditPendingRegister).values(row);
}

export async function listPendingRegister(tenantId: string, status = "pending", limit = 500): Promise<PendingRegisterRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(auditPendingRegister).where(
    and(eq(auditPendingRegister.tenantId, tenantId), eq(auditPendingRegister.status, status)),
  ).limit(limit));
}

// --- P0-4: persistent, tenant-scoped compliance checklists ---

export async function insertChecklist(tx: Writer, row: typeof auditChecklists.$inferInsert): Promise<void> {
  await tx.insert(auditChecklists).values(row);
}

export async function findChecklistByIdTx(tx: Writer, id: string, tenantId: string): Promise<ChecklistRow | null> {
  const rows = await (tx as typeof db).select().from(auditChecklists)
    .where(and(eq(auditChecklists.id, id), eq(auditChecklists.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function listChecklists(tenantId: string, limit: number, offset: number): Promise<{ items: ChecklistRow[]; total: number }> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before these reads — bare db.select() calls run with no RLS GUC set.
  const { items, total } = await db.transaction(async (tx) => {
    const items = await tx.select().from(auditChecklists)
      .where(eq(auditChecklists.tenantId, tenantId))
      .orderBy(desc(auditChecklists.createdAt))
      .limit(limit).offset(offset);
    const totalRows = await tx.select({ count: sql<number>`count(*)::int` }).from(auditChecklists)
      .where(eq(auditChecklists.tenantId, tenantId));
    return { items, total: totalRows[0]?.count ?? 0 };
  });
  return { items, total };
}

/** Optimistic-locked completion. Returns rows affected (0 = not found / already completed / stale). */
export async function completeChecklistVersioned(tx: Writer, id: string, tenantId: string, expectedVersion: number, completedBy: string): Promise<number> {
  const res = await tx.update(auditChecklists)
    .set({ completed: true, completedBy, completedAt: new Date(), updatedAt: new Date(), version: expectedVersion + 1 })
    .where(and(
      eq(auditChecklists.id, id),
      eq(auditChecklists.tenantId, tenantId),
      eq(auditChecklists.version, expectedVersion),
      eq(auditChecklists.completed, false),
    ))
    .returning({ id: auditChecklists.id });
  return res.length;
}
