import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  financeBudgetAllocation, financeReappropriationLog,
  type BudgetAllocationRow, type BudgetAllocationInsert,
} from "./allocation-schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findAllocation(tenantId: string, headId: string, fy: string): Promise<BudgetAllocationRow | null> {
  const rows = await db.select().from(financeBudgetAllocation)
    .where(and(
      eq(financeBudgetAllocation.tenantId, tenantId),
      eq(financeBudgetAllocation.headId, headId),
      eq(financeBudgetAllocation.fy, fy),
    )).limit(1);
  return rows[0] ?? null;
}

export async function findAllocationTx(tx: Writer, tenantId: string, headId: string, fy: string): Promise<BudgetAllocationRow | null> {
  const rows = await (tx as typeof db).select().from(financeBudgetAllocation)
    .where(and(
      eq(financeBudgetAllocation.tenantId, tenantId),
      eq(financeBudgetAllocation.headId, headId),
      eq(financeBudgetAllocation.fy, fy),
    )).limit(1);
  return rows[0] ?? null;
}

export async function upsertAllocation(tx: Writer, row: BudgetAllocationInsert): Promise<void> {
  const existing = await findAllocationTx(tx, row.tenantId, row.headId, row.fy);
  if (existing) {
    const patch: Partial<BudgetAllocationInsert> = {
      updatedBy: row.updatedBy,
      updatedAt: new Date(),
      version: (existing.version ?? 1) + 1,
    };
    if (row.allocatedMinor !== undefined) patch.allocatedMinor = row.allocatedMinor;
    if (row.enforce !== undefined) patch.enforce = row.enforce;
    await tx.update(financeBudgetAllocation).set(patch).where(eq(financeBudgetAllocation.id, existing.id));
  } else {
    await tx.insert(financeBudgetAllocation).values(row);
  }
}

export async function addCommitted(tx: Writer, id: string, deltaMinor: bigint): Promise<void> {
  await tx.update(financeBudgetAllocation)
    .set({ committedMinor: sql`${financeBudgetAllocation.committedMinor} + ${deltaMinor}`, updatedAt: new Date() })
    .where(eq(financeBudgetAllocation.id, id));
}

export async function moveAllocation(tx: Writer, fromId: string, toId: string, amountMinor: bigint): Promise<void> {
  await tx.update(financeBudgetAllocation)
    .set({ allocatedMinor: sql`${financeBudgetAllocation.allocatedMinor} - ${amountMinor}`, updatedAt: new Date() })
    .where(eq(financeBudgetAllocation.id, fromId));
  await tx.update(financeBudgetAllocation)
    .set({ allocatedMinor: sql`${financeBudgetAllocation.allocatedMinor} + ${amountMinor}`, updatedAt: new Date() })
    .where(eq(financeBudgetAllocation.id, toId));
}

export async function logReappropriation(tx: Writer, row: typeof financeReappropriationLog.$inferInsert): Promise<void> {
  await tx.insert(financeReappropriationLog).values(row);
}

export async function listAllocations(tenantId: string, fy: string | undefined, limit: number) {
  const conditions = [eq(financeBudgetAllocation.tenantId, tenantId)];
  if (fy) conditions.push(eq(financeBudgetAllocation.fy, fy));
  return db.select().from(financeBudgetAllocation).where(and(...conditions)).limit(limit);
}

/** Executor that can run raw SQL (drizzle db or tx). */
type Exec = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

/**
 * Atomic, race-safe commitment registration. Increments committed_minor only if
 * the row is enforce=false OR there is still enough headroom. Returns true when a
 * row was updated, false when the guard rejected it (caller must reject the bill).
 */
export async function addCommittedGuarded(tx: Exec, id: string, deltaMinor: bigint): Promise<boolean> {
  const rows = await tx.execute(sql`
    UPDATE budget.finance_budget_allocation
       SET committed_minor = committed_minor + ${deltaMinor}, updated_at = now()
     WHERE id = ${id}
       AND (enforce = false OR allocated_minor - committed_minor - actual_minor >= ${deltaMinor})
    RETURNING id
  `);
  return (rows as unknown as unknown[]).length > 0;
}

/**
 * Atomic re-appropriation move guarded against driving the source allocation
 * below its already-committed+actual usage. Decrements source and increments
 * target in a single statement pair under the surrounding tx. Returns false if
 * the source guard rejected the move.
 */
export async function moveAllocationGuarded(tx: Exec, fromId: string, toId: string, amountMinor: bigint): Promise<boolean> {
  const dec = await tx.execute(sql`
    UPDATE budget.finance_budget_allocation
       SET allocated_minor = allocated_minor - ${amountMinor}, updated_at = now()
     WHERE id = ${fromId}
       AND allocated_minor - committed_minor - actual_minor >= ${amountMinor}
    RETURNING id
  `);
  if ((dec as unknown as unknown[]).length === 0) return false;
  await tx.execute(sql`
    UPDATE budget.finance_budget_allocation
       SET allocated_minor = allocated_minor + ${amountMinor}, updated_at = now()
     WHERE id = ${toId}
  `);
  return true;
}
