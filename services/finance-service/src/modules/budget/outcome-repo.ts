import { eq, and, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  financeBudgetOutcomes,
  type BudgetOutcomeRow, type BudgetOutcomeInsert,
} from "./outcome-schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertOutcome(tx: Writer, row: BudgetOutcomeInsert): Promise<void> {
  await tx.insert(financeBudgetOutcomes).values(row);
}

export async function findOutcomeByIdTx(tx: Writer, id: string, tenantId: string): Promise<BudgetOutcomeRow | null> {
  const rows = await (tx as typeof db).select().from(financeBudgetOutcomes)
    .where(and(eq(financeBudgetOutcomes.id, id), eq(financeBudgetOutcomes.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findOutcomeById(id: string, tenantId: string): Promise<BudgetOutcomeRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(financeBudgetOutcomes)
    .where(and(eq(financeBudgetOutcomes.id, id), eq(financeBudgetOutcomes.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function updateOutcome(tx: Writer, id: string, patch: Partial<BudgetOutcomeInsert>): Promise<void> {
  await tx.update(financeBudgetOutcomes)
    .set({ ...patch, updatedAt: new Date(), version: sql`${financeBudgetOutcomes.version} + 1` })
    .where(eq(financeBudgetOutcomes.id, id));
}

export async function listOutcomes(
  tenantId: string,
  filter: { fy?: string | undefined; headId?: string | undefined },
  limit: number,
): Promise<BudgetOutcomeRow[]> {
  const conds = [eq(financeBudgetOutcomes.tenantId, tenantId)];
  if (filter.fy) conds.push(eq(financeBudgetOutcomes.fy, filter.fy));
  if (filter.headId) conds.push(eq(financeBudgetOutcomes.headId, filter.headId));
  return scopedRead((tx) => tx.select().from(financeBudgetOutcomes).where(and(...conds)).limit(limit));
}
