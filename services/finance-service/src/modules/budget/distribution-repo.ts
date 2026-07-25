import { eq, and, ne, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  financeAllocationDistributions,
  type AllocationDistributionRow, type AllocationDistributionInsert,
} from "./distribution-schema.js";
import { financeBudgetAllocation, type BudgetAllocationRow } from "./allocation-schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

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
