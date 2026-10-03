import { and, asc, desc, eq, sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { hrmsOutsourcedContracts as t, type OutsourcedContractRow } from "./schema.js";

export interface OutsourcedStats {
  contracts: number;
  vendors: number;
  activeContracts: number;
  expiringIn60Days: number;
  totalHeadcount: number;
}

/** Contract-level register page + a real total + whole-tenant stats (never derived from the page). */
export async function listContracts(
  tenantId: string,
  opts: { limit: number; offset: number; status?: "active" | "terminated"; today: string },
): Promise<{ rows: OutsourcedContractRow[]; total: number; stats: OutsourcedStats }> {
  return scopedRead(async (tx) => {
    const where = and(eq(t.tenantId, tenantId), ...(opts.status ? [eq(t.status, opts.status)] : []));
    const rows = await tx.select().from(t).where(where)
      // stable order: soonest-ending first, id as the tie-breaker so paging never skips/repeats
      .orderBy(asc(t.contractEnd), desc(t.createdAt), asc(t.id))
      .limit(opts.limit).offset(opts.offset);
    const totalRows = await tx.select({ total: sql<number>`count(*)::int` }).from(t).where(where);
    const statRows = await tx.select({
      contracts: sql<number>`count(*)::int`,
      vendors: sql<number>`count(distinct lower(${t.vendorName}))::int`,
      activeContracts: sql<number>`count(*) filter (where ${t.status} = 'active' and ${t.contractEnd} >= ${opts.today}::date)::int`,
      expiringIn60Days: sql<number>`count(*) filter (where ${t.status} = 'active' and ${t.contractEnd} >= ${opts.today}::date and ${t.contractEnd} <= (${opts.today}::date + 60))::int`,
      totalHeadcount: sql<number>`coalesce(sum(${t.headcount}) filter (where ${t.status} = 'active' and ${t.contractEnd} >= ${opts.today}::date), 0)::int`,
    }).from(t).where(eq(t.tenantId, tenantId));
    return {
      rows,
      total: totalRows[0]?.total ?? 0,
      stats: statRows[0] ?? { contracts: 0, vendors: 0, activeContracts: 0, expiringIn60Days: 0, totalHeadcount: 0 },
    };
  });
}

export async function findContract(tenantId: string, id: string): Promise<OutsourcedContractRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(t).where(and(eq(t.tenantId, tenantId), eq(t.id, id))).limit(1));
  return rows[0] ?? null;
}
