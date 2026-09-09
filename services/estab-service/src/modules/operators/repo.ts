import { eq, and, asc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabFileOperator } from "./schema.js";
import type { OperatorRow, OperatorInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function findOperatorById(id: string, tenantId: string): Promise<OperatorRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(estabFileOperator)
    .where(and(eq(estabFileOperator.id, id), eq(estabFileOperator.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function listOperators(tenantId: string, limit: number): Promise<OperatorRow[]> {
  return db.transaction((tx) => tx.select().from(estabFileOperator)
    .where(eq(estabFileOperator.tenantId, tenantId))
    .orderBy(asc(estabFileOperator.division), asc(estabFileOperator.deskRole))
    .limit(limit));
}

/** Active desks for a given employee (an employee may hold desks in >1 division). */
// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function findActiveOperatorsForEmployee(tenantId: string, employeeId: string): Promise<OperatorRow[]> {
  return db.transaction((tx) => tx.select().from(estabFileOperator).where(and(
    eq(estabFileOperator.tenantId, tenantId),
    eq(estabFileOperator.employeeId, employeeId),
    eq(estabFileOperator.active, true),
  )));
}

/** Has this tenant enrolled ANY active operator? Drives adoption-aware gating. */
// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function hasActiveOperators(tenantId: string): Promise<boolean> {
  const rows = await db.transaction((tx) => tx.select({ id: estabFileOperator.id }).from(estabFileOperator)
    .where(and(eq(estabFileOperator.tenantId, tenantId), eq(estabFileOperator.active, true)))
    .limit(1));
  return rows.length > 0;
}

/**
 * TX-001 — tenant-scoped sibling of findOperatorById(). Reads through a
 * caller-supplied transaction handle so an already-open db.transaction()
 * (e.g. operatorUpdate's consumer) does not open a second, bare
 * db.transaction() from inside itself: under pool.max concurrent in-flight
 * consumer transactions, the nested call has no free connection to open on
 * and deadlocks the pool silently. Route every read that happens inside an
 * already-open consumer transaction through this, not findOperatorById().
 */
export async function findOperatorByIdTx(tx: Writer, id: string, tenantId: string): Promise<OperatorRow | null> {
  const rows = await tx.select().from(estabFileOperator)
    .where(and(eq(estabFileOperator.id, id), eq(estabFileOperator.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function insertOperator(tx: Writer, row: OperatorInsert): Promise<void> {
  await tx.insert(estabFileOperator).values(row);
}

export async function updateOperator(tx: Writer, id: string, patch: Partial<OperatorInsert>): Promise<void> {
  await tx.update(estabFileOperator).set({ ...patch, updatedAt: new Date() }).where(eq(estabFileOperator.id, id));
}
