import { eq, and } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  financeBudgetProposals,
  type BudgetProposalRow, type BudgetProposalInsert,
} from "./formulation-schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertProposal(tx: Writer, row: BudgetProposalInsert): Promise<void> {
  await tx.insert(financeBudgetProposals).values(row);
}

export async function findProposalByIdTx(tx: Writer, id: string, tenantId: string): Promise<BudgetProposalRow | null> {
  const rows = await (tx as typeof db).select().from(financeBudgetProposals)
    .where(and(eq(financeBudgetProposals.id, id), eq(financeBudgetProposals.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findProposalById(id: string, tenantId: string): Promise<BudgetProposalRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(financeBudgetProposals)
    .where(and(eq(financeBudgetProposals.id, id), eq(financeBudgetProposals.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function updateProposal(tx: Writer, id: string, patch: Partial<BudgetProposalInsert>): Promise<void> {
  await tx.update(financeBudgetProposals)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(financeBudgetProposals.id, id));
}

export async function listProposals(
  tenantId: string,
  filter: { fy?: string | undefined; deptCode?: string | undefined; status?: string | undefined },
  limit: number,
): Promise<BudgetProposalRow[]> {
  const conds = [eq(financeBudgetProposals.tenantId, tenantId)];
  if (filter.fy) conds.push(eq(financeBudgetProposals.fy, filter.fy));
  if (filter.deptCode) conds.push(eq(financeBudgetProposals.deptCode, filter.deptCode));
  if (filter.status) conds.push(eq(financeBudgetProposals.status, filter.status));
  return scopedRead((tx) => tx.select().from(financeBudgetProposals).where(and(...conds)).limit(limit));
}

/**
 * Consolidation feed: the latest APPROVED proposals for an FY (one figure per
 * head — the highest version wins via a DISTINCT ON). Read inside the tenant
 * transaction so RLS scopes rows.
 */
export async function listApprovedForConsolidation(tenantId: string, fy: string): Promise<BudgetProposalRow[]> {
  return scopedRead((tx) => tx.select().from(financeBudgetProposals)
    .where(and(
      eq(financeBudgetProposals.tenantId, tenantId),
      eq(financeBudgetProposals.fy, fy),
      eq(financeBudgetProposals.status, "approved"),
    )));
}
