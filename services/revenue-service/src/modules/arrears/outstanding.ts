import { eq, and, desc, sql } from "drizzle-orm";
import { dcbEntries, demands } from "../assessment/schema.js";
import { waivers } from "../trade-license/schema.js";
import { waiverCap, type WaiverComponent } from "./domain.js";

/** Advisory-lock key serialising waiver creation per (tenant, demand). */
export function waiverLockKey(tenantId: string, demandId: string): string {
  return `waiver:${tenantId}:${demandId}`;
}

/**
 * UAT B9-waiver (review): serialise waiver creation on one demand for the rest of this transaction.
 * The cap is "component minus SUM(pending + approved)", a read-then-insert; under READ COMMITTED
 * concurrent creates all read the same SUM and all pass. Same advisory-lock pattern as the
 * write-off approval re-check. Take it BEFORE loadWaiverCapTx.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function lockDemandWaiversTx(tx: any, tenantId: string, demandId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${waiverLockKey(tenantId, demandId)}, 0))`);
}

/**
 * GAP-REVENUE-WAIVERS-01 / UAT B9-waiver: the remaining waivable amount (paise) on a demand for the
 * chosen component(s), or null when the demand does not exist for the tenant. The cap is per DEMAND,
 * not per request: everything already waived (pending + approved) on it is subtracted, otherwise N
 * requests of up to the cap each would pass. Earlier waivers carry no component, so they count
 * against whichever component is requested (conservative). Used by the create route (synchronous
 * 422) and by the consumer (authoritative, in its own tx).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadWaiverCapTx(tx: any, tenantId: string, demandId: string, component: WaiverComponent): Promise<bigint | null> {
  const demandRows = await tx
    .select({ penaltyMinor: demands.penaltyMinor, interestMinor: demands.interestMinor })
    .from(demands)
    .where(and(eq(demands.tenantId, tenantId), eq(demands.id, demandId)))
    .limit(1);
  const demand = demandRows[0];
  if (!demand) return null;
  const componentCap = waiverCap(component, BigInt(demand.penaltyMinor), BigInt(demand.interestMinor));
  const waivedRows = await tx
    .select({ total: sql<string>`COALESCE(SUM(CAST(${waivers.amountMinor} AS numeric)), 0)::text` })
    .from(waivers)
    .where(
      and(
        eq(waivers.tenantId, tenantId),
        eq(waivers.demandId, demandId),
        sql`${waivers.status} IN ('pending', 'approved')`,
      ),
    );
  const alreadyWaived = BigInt(String(waivedRows[0]?.total ?? "0").split(".")[0] || "0");
  return componentCap > alreadyWaived ? componentCap - alreadyWaived : 0n;
}

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
