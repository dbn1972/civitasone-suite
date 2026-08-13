import { eq, and, sql, desc } from "drizzle-orm";
import { db, scopedRead, type ScopedTx } from "../../shared/db.js";
import { sewerageDesludgingBookings, type BookingRow, type BookingInsert } from "./schema.js";

export function toView(r: BookingRow) {
  return {
    id: r.id, tenantId: r.tenantId, bookingNumber: r.bookingNumber, requestedBy: r.requestedBy,
    address: r.address, tankCapacityLitres: r.tankCapacityLitres,
    requestedDate: r.requestedDate, requestedSlot: r.requestedSlot,
    status: r.status, vehicleId: r.vehicleId, feeMinor: r.feeMinor, feePaid: r.feePaid,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<BookingRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(sewerageDesludgingBookings).where(and(eq(sewerageDesludgingBookings.id, id), eq(sewerageDesludgingBookings.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function listByTenant(tenantId: string, limit: number, offset: number, status?: string) {
  const conditions = [eq(sewerageDesludgingBookings.tenantId, tenantId)];
  if (status) conditions.push(eq(sewerageDesludgingBookings.status, status));
  const where = and(...conditions);
  const rows = await scopedRead((tx) =>
    tx.select().from(sewerageDesludgingBookings).where(where).orderBy(desc(sewerageDesludgingBookings.createdAt)).limit(limit).offset(offset),
  );
  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(sewerageDesludgingBookings).where(where),
  );
  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insert(tx: ScopedTx, row: BookingInsert): Promise<void> {
  await tx.insert(sewerageDesludgingBookings).values(row);
}

export async function update(tx: ScopedTx, id: string, tenantId: string, patch: Partial<BookingInsert>, currentVersion: number): Promise<boolean> {
  const result = await tx
    .update(sewerageDesludgingBookings)
    .set({ ...patch, updatedAt: new Date(), version: sql`${sewerageDesludgingBookings.version} + 1` })
    .where(and(eq(sewerageDesludgingBookings.id, id), eq(sewerageDesludgingBookings.tenantId, tenantId), eq(sewerageDesludgingBookings.version, currentVersion)))
    .returning({ id: sewerageDesludgingBookings.id });
  return result.length > 0;
}
