import { eq, and, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  financeSupplementaryDemands,
  type SupplementaryDemandRow, type SupplementaryDemandInsert,
} from "./supplementary-schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
type Exec = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

export async function insertSupplementary(tx: Writer, row: SupplementaryDemandInsert): Promise<void> {
  await tx.insert(financeSupplementaryDemands).values(row);
}

export async function findSupplementaryByIdTx(tx: Writer, id: string, tenantId: string): Promise<SupplementaryDemandRow | null> {
  const rows = await (tx as typeof db).select().from(financeSupplementaryDemands)
    .where(and(eq(financeSupplementaryDemands.id, id), eq(financeSupplementaryDemands.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findSupplementaryById(id: string, tenantId: string): Promise<SupplementaryDemandRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(financeSupplementaryDemands)
    .where(and(eq(financeSupplementaryDemands.id, id), eq(financeSupplementaryDemands.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function updateSupplementary(tx: Writer, id: string, patch: Partial<SupplementaryDemandInsert>): Promise<void> {
  await tx.update(financeSupplementaryDemands)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(financeSupplementaryDemands.id, id));
}

export async function listSupplementary(
  tenantId: string,
  filter: { fy?: string | undefined; status?: string | undefined; budgetId?: string | undefined },
  limit: number,
): Promise<SupplementaryDemandRow[]> {
  const conds = [eq(financeSupplementaryDemands.tenantId, tenantId)];
  if (filter.fy) conds.push(eq(financeSupplementaryDemands.fy, filter.fy));
  if (filter.status) conds.push(eq(financeSupplementaryDemands.status, filter.status));
  if (filter.budgetId) conds.push(eq(financeSupplementaryDemands.budgetId, filter.budgetId));
  return scopedRead((tx) => tx.select().from(financeSupplementaryDemands).where(and(...conds)).limit(limit));
}

/**
 * Apply the granted supplementary to the target budget: raise both be_minor and
 * re_minor by the amount (RE ≤ BE preserved, availability increases). Guarded on
 * tenant + budget id; returns true when a row was updated. Runs in the caller
 * tx so it commits atomically with the status flip to 'approved'.
 */
export async function applySupplementaryToBudget(
  tx: Exec, budgetId: string, tenantId: string, amountMinor: bigint, updatedBy: string,
): Promise<boolean> {
  const rows = await tx.execute(sql`
    UPDATE budget.finance_budgets
       SET be_minor = be_minor + ${amountMinor},
           re_minor = re_minor + ${amountMinor},
           updated_by = ${updatedBy}, updated_at = now()
     WHERE id = ${budgetId} AND tenant_id = ${tenantId}
    RETURNING id
  `);
  return (rows as unknown as unknown[]).length > 0;
}
