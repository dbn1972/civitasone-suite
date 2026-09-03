import { eq, and, ne, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  financeAllocationDistributions,
  type AllocationDistributionRow, type AllocationDistributionInsert,
} from "./distribution-schema.js";
import { financeBudgetAllocation, type BudgetAllocationRow } from "./allocation-schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
/** Executor surface for raw guarded SQL (FOR UPDATE row locks). */
type Executor = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

export async function insertDistribution(tx: Writer, row: AllocationDistributionInsert): Promise<void> {
  await tx.insert(financeAllocationDistributions).values(row);
}

export async function findDistributionByIdTx(tx: Writer, id: string, tenantId: string): Promise<AllocationDistributionRow | null> {
  const rows = await (tx as typeof db).select().from(financeAllocationDistributions)
    .where(and(eq(financeAllocationDistributions.id, id), eq(financeAllocationDistributions.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findDistributionById(id: string, tenantId: string): Promise<AllocationDistributionRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(financeAllocationDistributions)
    .where(and(eq(financeAllocationDistributions.id, id), eq(financeAllocationDistributions.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function updateDistribution(tx: Writer, id: string, patch: Partial<AllocationDistributionInsert>): Promise<void> {
  await tx.update(financeAllocationDistributions)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(financeAllocationDistributions.id, id));
}

export async function listDistributions(
  tenantId: string,
  filter: { allocationId?: string | undefined; fy?: string | undefined; toOfficeId?: string | undefined },
  limit: number,
): Promise<AllocationDistributionRow[]> {
  const conds = [eq(financeAllocationDistributions.tenantId, tenantId)];
  if (filter.allocationId) conds.push(eq(financeAllocationDistributions.allocationId, filter.allocationId));
  if (filter.fy) conds.push(eq(financeAllocationDistributions.fy, filter.fy));
  if (filter.toOfficeId) conds.push(eq(financeAllocationDistributions.toOfficeId, filter.toOfficeId));
  return scopedRead((tx) => tx.select().from(financeAllocationDistributions).where(and(...conds)).limit(limit));
}

/** Parent allocation lookup by id (tenant-scoped). */
export async function findAllocationByIdTx(tx: Writer, id: string, tenantId: string): Promise<BudgetAllocationRow | null> {
  const rows = await (tx as typeof db).select().from(financeBudgetAllocation)
    .where(and(eq(financeBudgetAllocation.id, id), eq(financeBudgetAllocation.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

/**
 * Parent allocation lookup by id (tenant-scoped), read-only, no transaction.
 * Mirrors the findAllocationByIdTx/findAllocationById and sumDistributedTx/
 * sumDistributed naming split used elsewhere in this file: the Tx-suffixed
 * variant takes a caller-supplied transaction/writer, this plain variant runs
 * its own scopedRead. Used for a synchronous pre-accept existence check on
 * POST /allocation-distributions — see distribution-routes.ts.
 */
export async function findAllocationById(id: string, tenantId: string): Promise<BudgetAllocationRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(financeBudgetAllocation)
    .where(and(eq(financeBudgetAllocation.id, id), eq(financeBudgetAllocation.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

/**
 * Parent allocation lookup that takes a FOR UPDATE row lock on the allocation
 * (tenant-scoped). Closes the over-distribution TOCTOU race: concurrent
 * POST /allocation-distributions requests must each acquire this same row lock
 * before reading the distributed sum, so they serialise -- the second txn blocks
 * until the first commits, then sees the first's inserted distribution in its
 * sumDistributedTx read and the in-app assertWithinAllocation guard rejects the
 * overdraw. Caller MUST run inside a transaction. Mirrors the treasury
 * findDepositByIdForUpdateTx pattern (raw SELECT ... FOR UPDATE mapped back onto
 * the drizzle row shape).
 */
export async function lockAllocationByIdTx(tx: Writer, id: string, tenantId: string): Promise<BudgetAllocationRow | null> {
  const res = await (tx as unknown as Executor).execute(sql`
    SELECT * FROM budget.finance_budget_allocation
     WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE
  `);
  const raw = (res as { rows?: unknown[] }).rows ?? (res as unknown[]);
  const arr = raw as Array<Record<string, unknown>>;
  if (!arr[0]) return null;
  const r = arr[0];
  return {
    id: r.id as string, tenantId: r.tenant_id as string, headId: r.head_id as string,
    fy: r.fy as string,
    allocatedMinor: BigInt(r.allocated_minor as string),
    committedMinor: BigInt(r.committed_minor as string),
    actualMinor: BigInt(r.actual_minor as string),
    currency: r.currency as string,
    createdAt: r.created_at as Date, updatedAt: r.updated_at as Date,
    createdBy: r.created_by as string, updatedBy: r.updated_by as string,
    version: r.version as number,
  } as BudgetAllocationRow;
}

/**
 * Sum of all non-returned distributions against an allocation (draft, issued and
 * acknowledged all reserve headroom). Read within the caller tx so the running
 * total is consistent with the insert that follows in the same transaction.
 */
export async function sumDistributedTx(tx: Writer, allocationId: string, tenantId: string): Promise<bigint> {
  const rows = await (tx as typeof db).select({
    total: sql<string>`coalesce(sum(${financeAllocationDistributions.amountMinor}), 0)`,
  }).from(financeAllocationDistributions)
    .where(and(
      eq(financeAllocationDistributions.allocationId, allocationId),
      eq(financeAllocationDistributions.tenantId, tenantId),
      ne(financeAllocationDistributions.status, "returned"),
    ));
  return BigInt(rows[0]?.total ?? "0");
}

export async function sumDistributed(allocationId: string, tenantId: string): Promise<bigint> {
  return scopedRead((tx) => sumDistributedTx(tx, allocationId, tenantId));
}
