import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { parkingBookings, type BookingRow, type BookingInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<BookingRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(parkingBookings)
      .where(and(eq(parkingBookings.id, id), eq(parkingBookings.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function list(
  tenantId: string,
  opts: { status?: string | undefined; facilityId?: string | undefined; page?: number | undefined; pageSize?: number | undefined } = {},
): Promise<{ rows: BookingRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(parkingBookings.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(parkingBookings.status, opts.status));
  if (opts.facilityId) conditions.push(eq(parkingBookings.facilityId, opts.facilityId));

  const rows = await scopedRead((tx) =>
    tx.select().from(parkingBookings)
      .where(and(...conditions))
      .orderBy(desc(parkingBookings.createdAt))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(parkingBookings)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertBooking(tx: ScopedTx, row: BookingInsert): Promise<void> {
  await tx.insert(parkingBookings).values(row);
}

export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  updatedBy: string,
  extra?: { entryTime?: Date; exitTime?: Date; durationMinutes?: number; amountMinor?: bigint; spaceNumber?: string; paymentRef?: string },
): Promise<boolean> {
  const result = await tx.update(parkingBookings)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      ...(extra?.entryTime ? { entryTime: extra.entryTime } : {}),
      ...(extra?.exitTime ? { exitTime: extra.exitTime } : {}),
      ...(extra?.durationMinutes !== undefined ? { durationMinutes: extra.durationMinutes } : {}),
      ...(extra?.amountMinor !== undefined ? { amountMinor: extra.amountMinor } : {}),
      ...(extra?.spaceNumber ? { spaceNumber: extra.spaceNumber } : {}),
      ...(extra?.paymentRef ? { paymentRef: extra.paymentRef } : {}),
      version: sql`${parkingBookings.version} + 1`,
    })
    .where(and(eq(parkingBookings.id, id), eq(parkingBookings.tenantId, tenantId)))
    .returning({ id: parkingBookings.id });
  return result.length > 0;
}
