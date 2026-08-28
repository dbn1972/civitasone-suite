import { eq, and, sql, desc, inArray } from "drizzle-orm";
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
  opts: { status?: string | undefined; facilityId?: string | undefined; page?: number | undefined; pageSize?: number | undefined; createdBy?: string | undefined } = {},
): Promise<{ rows: BookingRow[]; total: number }> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const conditions = [eq(parkingBookings.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(parkingBookings.status, opts.status));
  if (opts.facilityId) conditions.push(eq(parkingBookings.facilityId, opts.facilityId));
  // Restricts a non-admin citizen's list view to bookings they created (see
  // routes.ts) — omitted for staff, who see the full tenant-wide list.
  if (opts.createdBy) conditions.push(eq(parkingBookings.createdBy, opts.createdBy));

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

/**
 * Atomically guarded by `fromStatuses`: the UPDATE only matches a row whose
 * CURRENT status is still one of `fromStatuses`. Previously this had no status
 * precondition at all — recordEntry could re-activate a completed/cancelled
 * booking, and a delayed/duplicate recordExit could re-bill an already-completed
 * booking from its stale entryTime (a concrete double-billing/replay path).
 * Returns the updated row (null if no row matched) so callers can prime the read
 * cache and know definitively whether their write actually landed.
 */
export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  fromStatuses: readonly string[],
  updatedBy: string,
  extra?: { entryTime?: Date; exitTime?: Date; durationMinutes?: number; amountMinor?: bigint; spaceNumber?: string; paymentRef?: string },
): Promise<BookingRow | null> {
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
    .where(and(
      eq(parkingBookings.id, id),
      eq(parkingBookings.tenantId, tenantId),
      inArray(parkingBookings.status, fromStatuses as string[]),
    ))
    .returning();
  return result[0] ?? null;
}
