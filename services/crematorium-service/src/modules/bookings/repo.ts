import { eq, and, sql, desc } from "drizzle-orm";
import { scopedRead, type ScopedTx } from "../../shared/db.js";
import { crematoriumBookings, type BookingRow, type BookingInsert } from "./schema.js";

export async function findById(id: string, tenantId: string): Promise<BookingRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(crematoriumBookings)
      .where(and(eq(crematoriumBookings.id, id), eq(crematoriumBookings.tenantId, tenantId)))
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

  const conditions = [eq(crematoriumBookings.tenantId, tenantId)];
  if (opts.status) conditions.push(eq(crematoriumBookings.status, opts.status));
  if (opts.facilityId) conditions.push(eq(crematoriumBookings.facilityId, opts.facilityId));

  const rows = await scopedRead((tx) =>
    tx.select().from(crematoriumBookings)
      .where(and(...conditions))
      .orderBy(desc(crematoriumBookings.createdAt))
      .limit(pageSize)
      .offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(crematoriumBookings)
      .where(and(...conditions)),
  );

  return { rows, total: countResult[0]?.count ?? 0 };
}

export async function insertBooking(tx: ScopedTx, row: BookingInsert): Promise<void> {
  await tx.insert(crematoriumBookings).values(row);
}

export async function updateStatus(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  status: string,
  updatedBy: string,
  extra?: { slotNumber?: string; completedAt?: Date; paymentRef?: string; feePaid?: boolean },
): Promise<boolean> {
  const result = await tx.update(crematoriumBookings)
    .set({
      status,
      updatedBy,
      updatedAt: new Date(),
      ...(extra?.slotNumber ? { slotNumber: extra.slotNumber } : {}),
      ...(extra?.completedAt ? { completedAt: extra.completedAt } : {}),
      ...(extra?.paymentRef ? { paymentRef: extra.paymentRef } : {}),
      ...(extra?.feePaid !== undefined ? { feePaid: extra.feePaid } : {}),
      version: sql`${crematoriumBookings.version} + 1`,
    })
    .where(and(eq(crematoriumBookings.id, id), eq(crematoriumBookings.tenantId, tenantId)))
    .returning({ id: crematoriumBookings.id });
  return result.length > 0;
}
