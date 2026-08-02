import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { procurementAuctions, procurementBids, type AuctionRow, type AuctionInsert, type BidInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findAuctionById(id: string, tenantId: string): Promise<AuctionRow | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(procurementAuctions)
    .where(and(eq(procurementAuctions.id, id), eq(procurementAuctions.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function findAuctionByIdTx(tx: Writer, id: string, tenantId: string): Promise<AuctionRow | null> {
  const rows = await (tx as typeof db).select().from(procurementAuctions)
    .where(and(eq(procurementAuctions.id, id), eq(procurementAuctions.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findBidsByAuctionTx(tx: Writer, auctionId: string): Promise<(typeof procurementBids.$inferSelect)[]> {
  return (tx as typeof db).select().from(procurementBids).where(eq(procurementBids.auctionId, auctionId));
}

export async function insertAuction(tx: Writer, row: AuctionInsert): Promise<void> {
  await tx.insert(procurementAuctions).values(row);
}

export async function updateAuction(tx: Writer, id: string, patch: Partial<AuctionInsert>): Promise<void> {
  await tx.update(procurementAuctions).set({ ...patch, updatedAt: new Date() }).where(eq(procurementAuctions.id, id));
}

/** Optimistic-locked auction update (#16): fails on stale `expectedVersion`. */
export async function updateAuctionVersioned(tx: Writer, id: string, expectedVersion: number, patch: Partial<AuctionInsert>): Promise<void> {
  const res = await (tx as typeof db).update(procurementAuctions)
    .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(procurementAuctions.id, id), eq(procurementAuctions.version, expectedVersion)))
    .returning({ id: procurementAuctions.id });
  if (res.length === 0) {
    throw new Error(`OPTIMISTIC_LOCK_CONFLICT: auction ${id} was modified concurrently (expected version ${expectedVersion})`);
  }
}

export async function insertBid(tx: Writer, row: BidInsert): Promise<void> {
  await tx.insert(procurementBids).values(row);
}

export async function updateBid(tx: Writer, id: string, patch: Partial<BidInsert>): Promise<void> {
  await tx.update(procurementBids).set({ ...patch, updatedAt: new Date() }).where(eq(procurementBids.id, id));
}

export async function listAuctionsByTenant(tenantId: string, limit: number, offset: number): Promise<AuctionRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(procurementAuctions)
    .where(eq(procurementAuctions.tenantId, tenantId))
    .orderBy(desc(procurementAuctions.createdAt))
    .limit(limit)
    .offset(offset));
}

export type AuctionBidStats = { auctionId: string; bidderCount: number; lowestEffectiveMinor: bigint | null };

/** Aggregate bid count + lowest effective bid per auction — one grouped query, no N+1. */
export async function getBidStatsByAuctionIds(tenantId: string, auctionIds: string[]): Promise<AuctionBidStats[]> {
  if (auctionIds.length === 0) return [];
  const rows = await db.transaction((tx) => tx
    .select({
      auctionId: procurementBids.auctionId,
      bidderCount: sql<number>`COUNT(DISTINCT ${procurementBids.vendorId})`,
      lowestEffectiveMinor: sql<string | null>`MIN(${procurementBids.effectiveMinor})`,
    })
    .from(procurementBids)
    .where(and(eq(procurementBids.tenantId, tenantId), inArray(procurementBids.auctionId, auctionIds)))
    .groupBy(procurementBids.auctionId));
  return rows.map((r) => ({
    auctionId: r.auctionId,
    bidderCount: Number(r.bidderCount),
    lowestEffectiveMinor: r.lowestEffectiveMinor != null ? BigInt(r.lowestEffectiveMinor) : null,
  }));
}
