import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { procurementAuctions, procurementBids, type AuctionRow, type AuctionInsert, type BidInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findAuctionById(id: string): Promise<AuctionRow | null> {
  const rows = await db.select().from(procurementAuctions).where(eq(procurementAuctions.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findAuctionByIdTx(tx: Writer, id: string): Promise<AuctionRow | null> {
  const rows = await (tx as typeof db).select().from(procurementAuctions).where(eq(procurementAuctions.id, id)).limit(1);
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

export async function insertBid(tx: Writer, row: BidInsert): Promise<void> {
  await tx.insert(procurementBids).values(row);
}

export async function updateBid(tx: Writer, id: string, patch: Partial<BidInsert>): Promise<void> {
  await tx.update(procurementBids).set({ ...patch, updatedAt: new Date() }).where(eq(procurementBids.id, id));
}
