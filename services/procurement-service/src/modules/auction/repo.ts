import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { procurementAuctions, procurementBids, type AuctionRow, type AuctionInsert, type BidInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findAuctionById(id: string, tenantId: string): Promise<AuctionRow | null> {
  const rows = await db.select().from(procurementAuctions)
    .where(and(eq(procurementAuctions.id, id), eq(procurementAuctions.tenantId, tenantId))).limit(1);
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
