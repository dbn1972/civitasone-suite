import { eq, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  assetWaterTankerBookings,
  type WaterTankerBookingInsert, type WaterTankerBookingRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertBooking(tx: Writer, row: WaterTankerBookingInsert): Promise<void> {
  await tx.insert(assetWaterTankerBookings).values(row);
}

export async function findBookingById(id: string, tenantId: string): Promise<WaterTankerBookingRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(assetWaterTankerBookings)
      .where(and(eq(assetWaterTankerBookings.id, id), eq(assetWaterTankerBookings.tenantId, tenantId)))
      .limit(1));
  return rows[0] ?? null;
}

export async function updateBookingStatus(
  tx: Writer, id: string, tenantId: string, status: string, extra?: Record<string, unknown>,
): Promise<void> {
  await (tx as typeof db).update(assetWaterTankerBookings)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(and(eq(assetWaterTankerBookings.id, id), eq(assetWaterTankerBookings.tenantId, tenantId)));
}

export async function listBookings(tenantId: string, opts?: { limit?: number; offset?: number }) {
  return scopedRead((tx) => tx.select().from(assetWaterTankerBookings)
    .where(eq(assetWaterTankerBookings.tenantId, tenantId))
    .orderBy(desc(assetWaterTankerBookings.createdAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0));
}
