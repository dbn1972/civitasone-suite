import { eq, and, desc, sql } from "drizzle-orm";
import { dcbEntries } from "../assessment/schema.js";

/**
 * Current outstanding balance (paise) for an assessee.
 *
 * `dcb_entries.balance_minor` is the RUNNING balance of a demand after each
 * entry (assessment/schema.ts), so summing every row double-counts: a fully
 * paid demand (charge row balance 100, receipt row balance 0) would sum to
 * 100. The outstanding amount is the sum of the LATEST entry per demand.
 * Ties on created_at (entries written in one transaction) fall back to id.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getAssesseeOutstanding(tx: any, tenantId: string, assesseeId: string): Promise<bigint> {
  const rows = await tx
    .select({ total: sql<bigint>`COALESCE(SUM(${dcbEntries.balanceMinor}), 0)` })
    .from(dcbEntries)
    .where(
      and(
        eq(dcbEntries.tenantId, tenantId),
        eq(dcbEntries.assesseeId, assesseeId),
        sql`${dcbEntries.id} IN (
          SELECT DISTINCT ON (l.demand_id) l.id
          FROM assessment.dcb_entries l
          WHERE l.tenant_id = ${tenantId} AND l.assessee_id = ${assesseeId}
          ORDER BY l.demand_id, l.created_at DESC, l.id DESC
        )`,
      ),
    );
  return BigInt(rows[0]?.total ?? 0n);
}

/**
 * Latest running balance of ONE demand's ledger (0 when it has no entries).
 * Used to chain a new entry onto that demand's running balance.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getLatestDemandBalance(tx: any, tenantId: string, demandId: string): Promise<bigint> {
  const rows = await tx
    .select({ balanceMinor: dcbEntries.balanceMinor })
    .from(dcbEntries)
    .where(and(eq(dcbEntries.tenantId, tenantId), eq(dcbEntries.demandId, demandId)))
    .orderBy(desc(dcbEntries.createdAt), desc(dcbEntries.id))
    .limit(1);
  return BigInt(rows[0]?.balanceMinor ?? 0n);
}
